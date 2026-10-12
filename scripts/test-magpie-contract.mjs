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
const dir = await mkdtemp(path.join(tmpdir(),"riic-magpie-contract-"));
const servers=[]; let child; const counts={primary:0,backup:0};
try {
  const cfg=path.join(dir,"magpie");await mkdir(cfg);
  const upstream = async (name,port) => {
    const server=createServer(async(req,res)=>{
      if(req.url.endsWith("/models")){res.setHeader("Content-Type","application/json");res.end(JSON.stringify({data:[{id:"test-model"}]}));return;}
      let raw="";for await(const c of req)raw+=c;const body=JSON.parse(raw); counts[name]++;
      const last=body.messages.at(-1).content;
      if(name==="primary"&&last==="fallback"){res.writeHead(429,{"Content-Type":"application/json"});res.end(JSON.stringify({error:{message:"contract rate limit"}}));return;}
      assert.equal(body.model,"test-model");assert.equal(body.stream_options.include_usage,true);
      res.setHeader("Content-Type","text/event-stream");
      const id=`contract-${name}-${counts[name]}`;
      const chunk=value=>res.write(`data: ${JSON.stringify({id,model:"test-model",created:1,object:"chat.completion.chunk",...value})}\n\n`);
      if(last==="tool"){
        assert.equal(body.tools[0].function.name,"contract_tool");
        chunk({choices:[{index:0,delta:{tool_calls:[{index:0,id:"tool-contract",type:"function",function:{name:"contract_tool",arguments:'{"ok":'}}]},finish_reason:null}]});
        chunk({choices:[{index:0,delta:{tool_calls:[{index:0,function:{arguments:'true}'}}]},finish_reason:null}]});
      }else chunk({choices:[{index:0,delta:{role:"assistant",content:"contract ok"},finish_reason:null}]});
      chunk({choices:[{index:0,delta:{},finish_reason:last==="tool"?"tool_calls":"stop"}],usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12,prompt_tokens_details:{cached_tokens:3}}});
      res.end("data: [DONE]\n\n");
    }); await new Promise(resolve=>server.listen(port,"127.0.0.1",resolve));servers.push(server);
  };
  await upstream("primary",3499);await upstream("backup",3500);
  await writeFile(path.join(cfg,"providers.json"),JSON.stringify({providers:[{id:"riic-primary",name:"primary",key:"contract-only",chat:"http://127.0.0.1:3499/v1",models:["test-model"]},{id:"riic-backup",name:"backup",key:"contract-only",chat:"http://127.0.0.1:3500/v1",models:["test-model"]}],groups:[{id:"riic-agent",name:"riic-agent",members:["riic-primary/test-model","riic-backup/test-model"],routing:"order",affinity:"turn"}]}));
  await writeFile(path.join(cfg,"plugins.json"),JSON.stringify({plugins:[{spec:process.env.MAGPIE_TEST_PLUGIN,options:{words:["RIIC_FILTER_BLOCK_TEST"],patterns:[],action:"reject",check:"all",message:"RIIC contract policy rejection"}}]}));
  child=spawn(process.env.MAGPIE_TEST_BINARY,["serve"],{env:{...process.env,XDG_CONFIG_HOME:dir,MAGPIE_ADDR:"127.0.0.1:3498",MAGPIE_NO_ACCOUNTS:"1"},stdio:"ignore"});
  let ready=false;
  for(let i=0;i<80;i++){try{const r=await globalThis.fetch("http://127.0.0.1:3498/v1/models");if(r.ok){ready=true;break;}}catch{/* Gateway is still starting. */}await delay(250);}
  assert.ok(ready,"gateway starts");
  const chat=async(text,model="group/riic-agent",extra={})=>{
    const response=await globalThis.fetch("http://127.0.0.1:3498/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","X-Magpie-Session":`contract-${text}`},body:JSON.stringify({model,messages:[{role:"user",content:text}],stream:true,stream_options:{include_usage:true},max_tokens:32,...extra})});
    return {response,text:await response.text()};
  };
  const normal=await chat("normal");assert.equal(normal.response.status,200);assert.equal(normal.response.headers.get("x-magpie-model"),"riic-primary/test-model");assert.match(normal.text,/contract ok/);
  const before=counts.primary+counts.backup;const blocked=await chat("RIIC_FILTER_BLOCK_TEST");assert.equal(blocked.response.status,400);assert.equal(counts.primary+counts.backup,before,"guard stops before upstream");
  const tool=await chat("tool","riic-primary/test-model",{tools:[{type:"function",function:{name:"contract_tool",parameters:{type:"object",properties:{ok:{type:"boolean"}},required:["ok"]}}}]});assert.equal(tool.response.status,200);assert.match(tool.text,/tool-contract/);assert.match(tool.text,/prompt_tokens/);
  const fallback=await chat("fallback");assert.equal(fallback.response.status,200);assert.equal(fallback.response.headers.get("x-magpie-provider"),"riic-backup");assert.equal(fallback.response.headers.get("x-magpie-model"),"riic-backup/test-model");
  await delay(500);
  const usage=await (await globalThis.fetch("http://127.0.0.1:3498/v1/magpie/usage/requests?limit=100&period=all")).json();
  const row=usage.rows.find(r=>r.session==="contract-normal"&&r.status===200);
  assert.equal(row.in,7);assert.equal(row.cache_read,3);assert.equal(row.out,2);assert.ok(row.response_id);assert.equal(row.priced,false);
  const route=await (await globalThis.fetch("http://127.0.0.1:3498/v1/magpie/route?session=contract-fallback")).json();
  assert.ok(route.route.tries.some(t=>t.status===429),"failed fallback attempt retained in routing API");
  console.log(JSON.stringify({passed:true,checks:["identity headers","stream usage and cache partition","tool call deltas","input guard rejects before upstream","429 fallback","failed attempt ledger"],version:"0.1.1203"}));
} finally {
  child?.kill();for(const server of servers)server.close();
  if(path.dirname(dir)===path.resolve(tmpdir())&&path.basename(dir).startsWith("riic-magpie-contract-")) await rm(dir,{recursive:true,force:true});
}
