import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { setTimeout as delay } from "node:timers/promises";

if (!process.env.MAGPIE_TEST_BINARY || !process.env.MAGPIE_TEST_PLUGIN || !process.env.MAGPIE_BUN) throw new Error("Pinned Magpie binary, word-guard and Bun paths required");
const firstToken=Number(process.env.MAGPIE_CONTRACT_FIRST_TOKEN_SECONDS ?? 1);
assert.ok(Number.isInteger(firstToken)&&firstToken>=1&&firstToken<=10,"bounded contract timeout");
const dir = await mkdtemp(path.join(tmpdir(),"riic-magpie-contract-"));
const servers=[]; let child; const counts={primary:0,backup:0,official:0};
try {
  const cfg=path.join(dir,"magpie");await mkdir(cfg);
  const upstream = async (name,port) => {
    const server=createServer(async(req,res)=>{
      if(req.url.endsWith("/models")){res.setHeader("Content-Type","application/json");res.end(JSON.stringify({data:[{id:"test-model"}]}));return;}
      let raw="";for await(const c of req)raw+=c;const body=JSON.parse(raw); counts[name]++;
      const last=body.messages.at(-1).content;
      if(name!=="official" && ["timeout-fallback", "keepalive-fallback"].includes(last)) {
        if(last==="keepalive-fallback") {
          res.writeHead(200,{"Content-Type":"text/event-stream"});
          res.write(": still waiting\n\n");
          res.write(`data: ${JSON.stringify({id:"empty-role",model:"test-model",object:"chat.completion.chunk",created:1,choices:[{index:0,delta:{role:"assistant"},finish_reason:null}]})}\n\n`);
          const keepalive=globalThis.setInterval(()=>res.write(": still waiting\n\n"),100);
          res.on("close",()=>globalThis.clearInterval(keepalive));
        }
        return;
      }
      if(name==="primary"&&last==="fallback"){res.writeHead(429,{"Content-Type":"application/json"});res.end(JSON.stringify({error:{message:"contract rate limit"}}));return;}
      if(name!=="official"&&last==="http-fallback"){res.writeHead(503,{"Content-Type":"application/json"});res.end(JSON.stringify({error:{message:"contract unavailable"}}));return;}
      assert.equal(body.model,"test-model");assert.equal(body.stream_options.include_usage,true);
      res.setHeader("Content-Type","text/event-stream");
      const id=`contract-${name}-${counts[name]}`;
      const chunk=value=>res.write(`data: ${JSON.stringify({id,model:"test-model",created:1,object:"chat.completion.chunk",...value})}\n\n`);
      if(last==="partial") {
        chunk({choices:[{index:0,delta:{role:"assistant",content:"partial reply"},finish_reason:null}]});
        const timer=globalThis.setTimeout(()=>res.end(),firstToken*1000+500);res.on("close",()=>globalThis.clearTimeout(timer));return;
      }
      if(last==="tool"){
        assert.equal(body.tools[0].function.name,"contract_tool");
        chunk({choices:[{index:0,delta:{tool_calls:[{index:0,id:"tool-contract",type:"function",function:{name:"contract_tool",arguments:'{"ok":'}}]},finish_reason:null}]});
        chunk({choices:[{index:0,delta:{tool_calls:[{index:0,function:{arguments:'true}'}}]},finish_reason:null}]});
      }else chunk({choices:[{index:0,delta:{role:"assistant",content:"contract ok"},finish_reason:null}]});
      chunk({choices:[{index:0,delta:{},finish_reason:last==="tool"?"tool_calls":"stop"}],usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12,prompt_tokens_details:{cached_tokens:3}}});
      res.end("data: [DONE]\n\n");
    }); await new Promise(resolve=>server.listen(port,"127.0.0.1",resolve));servers.push(server);
  };
  await upstream("primary",3499);await upstream("backup",3500);await upstream("official",3501);
  await writeFile(path.join(cfg,"providers.json"),JSON.stringify({providers:[{id:"riic-primary",name:"primary",key:"contract-only",chat:"http://127.0.0.1:3499/v1",models:["test-model"]},{id:"riic-backup",name:"backup",key:"contract-only",chat:"http://127.0.0.1:3500/v1",models:["test-model"]},{id:"riic-official",name:"official",key:"contract-only",chat:"http://127.0.0.1:3501/v1",models:["test-model"]}],groups:[{id:"riic-agent",name:"riic-agent",members:["riic-primary/test-model","riic-backup/test-model","riic-official/test-model"],routing:"order",affinity:"turn",firstToken,patience:-1}]}));
  await writeFile(path.join(cfg,"plugins.json"),JSON.stringify({plugins:[{spec:process.env.MAGPIE_TEST_PLUGIN,options:{words:["RIIC_FILTER_BLOCK_TEST"],patterns:[],action:"reject",check:"all",message:"RIIC contract policy rejection"}}]}));
  const startGateway=async()=>{
    if(child && child.exitCode===null) {
      const exited=new Promise(resolve=>child.once("exit",resolve));child.kill();await exited;
    }
    child=spawn(process.env.MAGPIE_TEST_BINARY,["serve"],{env:{...process.env,XDG_CONFIG_HOME:dir,MAGPIE_ADDR:"127.0.0.1:3498",MAGPIE_NO_ACCOUNTS:"1"},stdio:"ignore"});
    let ready=false;
    for(let i=0;i<80;i++){try{const r=await globalThis.fetch("http://127.0.0.1:3498/v1/models");if(r.ok){ready=true;break;}}catch{/* Gateway is still starting. */}await delay(250);}
    assert.ok(ready,"gateway starts");
  };
  await startGateway();
  const chat=async(text,model="group/riic-agent",extra={})=>{
    const response=await globalThis.fetch("http://127.0.0.1:3498/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","X-Magpie-Session":`contract-${text}`},body:JSON.stringify({model,messages:[{role:"user",content:text}],stream:true,stream_options:{include_usage:true},max_tokens:32,...extra})});
    return {response,text:await response.text()};
  };
  const normal=await chat("normal");assert.equal(normal.response.status,200);assert.equal(normal.response.headers.get("x-magpie-model"),"riic-primary/test-model");assert.match(normal.text,/contract ok/);
  const before=counts.primary+counts.backup+counts.official;const blocked=await chat("RIIC_FILTER_BLOCK_TEST");assert.equal(blocked.response.status,400);assert.equal(counts.primary+counts.backup+counts.official,before,"guard stops before upstream");
  const tool=await chat("tool","riic-primary/test-model",{tools:[{type:"function",function:{name:"contract_tool",parameters:{type:"object",properties:{ok:{type:"boolean"}},required:["ok"]}}}]});assert.equal(tool.response.status,200);assert.match(tool.text,/tool-contract/);assert.match(tool.text,/prompt_tokens/);
  const fallback=await chat("fallback");assert.equal(fallback.response.status,200);assert.equal(fallback.response.headers.get("x-magpie-provider"),"riic-backup");assert.equal(fallback.response.headers.get("x-magpie-model"),"riic-backup/test-model");
  const route=await (await globalThis.fetch("http://127.0.0.1:3498/v1/magpie/route?session=contract-fallback")).json();
  assert.ok(route.route.tries.some(t=>t.status===429),"failed fallback attempt retained in routing API");
  for(const text of ["timeout-fallback","keepalive-fallback","http-fallback"]) {
    // Each failure case starts without the previous case's circuit cooldown.
    await startGateway();
    const before={...counts};const started=Date.now();
    const result=await chat(text);
    assert.equal(result.response.status,200);assert.match(result.text,/contract ok/);
    assert.equal(result.response.headers.get("x-magpie-provider"),"riic-official");
    assert.equal(result.response.headers.get("x-magpie-model"),"riic-official/test-model");
    for(const name of ["primary","backup","official"])assert.equal(counts[name]-before[name],1,`${text}: ${name} attempted once`);
    assert.ok(Date.now()-started<firstToken*2000+6000,"both unresponsive upstreams are bounded");
    const data=await (await globalThis.fetch(`http://127.0.0.1:3498/v1/magpie/route?session=contract-${text}`)).json();
    assert.ok(data.route.tries.length>=3,"all three attempts are retained");
    assert.equal(data.route.model,"riic-official/test-model");
  }
  await startGateway();
  const recovered=await chat("recovered");assert.equal(recovered.response.headers.get("x-magpie-provider"),"riic-primary","healthy primary is preferred when no circuit cooldown applies");
  const beforePartial={...counts};const partial=await chat("partial");
  assert.equal(partial.response.headers.get("x-magpie-provider"),"riic-primary");assert.match(partial.text,/partial reply/);
  assert.equal(counts.backup,beforePartial.backup);assert.equal(counts.official,beforePartial.official,"partial output is never replayed");
  await delay(500);
  const usage=await (await globalThis.fetch("http://127.0.0.1:3498/v1/magpie/usage/requests?limit=100&period=all")).json();
  const row=usage.rows.find(r=>r.session==="contract-normal"&&r.status===200);
  assert.equal(row.in,7);assert.equal(row.cache_read,3);assert.equal(row.out,2);assert.ok(row.response_id);assert.equal(row.priced,false);
  console.log(JSON.stringify({passed:true,checks:["identity headers","stream usage and cache partition","tool call deltas","input guard rejects before upstream","429 fallback","two 503 failures reach third model","two no-header timeouts reach third model","role and keepalive-only streams reach third model","primary recovery","partial output is not replayed","failed attempt ledger"],version:"0.1.1203"}));
} finally {
  child?.kill();for(const server of servers)server.close();
  if(path.dirname(dir)===path.resolve(tmpdir())&&path.basename(dir).startsWith("riic-magpie-contract-")) await rm(dir,{recursive:true,force:true});
}
