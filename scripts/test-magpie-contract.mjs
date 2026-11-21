import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { setTimeout as delay } from "node:timers/promises";
import { once } from "node:events";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import { buildAgentGatewayConfig } from "../deploy/agent-model-gateway-config.mjs";

if (!process.env.MAGPIE_TEST_BINARY || !process.env.MAGPIE_TEST_PLUGIN || !process.env.MAGPIE_BUN) throw new Error("Pinned Magpie binary, word-guard and Bun paths required");
const firstToken=Number(process.env.MAGPIE_CONTRACT_FIRST_TOKEN_SECONDS ?? 1);
assert.ok(Number.isInteger(firstToken)&&firstToken>=1&&firstToken<=10,"bounded contract timeout");
const dir = await mkdtemp(path.join(tmpdir(),"riic-magpie-contract-"));
const servers=[]; let child; const counts={primary:0,backup:0,official:0,responses:0};
const pixel="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=";
let cancelledUpstream=false; let upstreamError;
try {
  const cfg=path.join(dir,"magpie");await mkdir(cfg);
  const upstream = async (name,port) => {
    const upstreamModel=name==="official"?"deepseek-flash":"test-model";
    const server=createServer(async(req,res)=>{
      if(req.url.endsWith("/models")){res.setHeader("Content-Type","application/json");res.end(JSON.stringify({data:[{id:upstreamModel}]}));return;}
      let raw="";for await(const c of req)raw+=c;const body=JSON.parse(raw); counts[name]++;
      const last=body.messages.at(-1).content;
      if((name!=="official" && ["timeout-fallback", "keepalive-fallback"].includes(last)) || (name==="primary" && last==="held-identity")) {
        if(last==="keepalive-fallback" || last==="held-identity") {
          res.writeHead(200,{"Content-Type":"text/event-stream"});
          res.write(": still waiting\n\n");
          res.write(`data: ${JSON.stringify({id:"empty-role",model:"test-model",object:"chat.completion.chunk",created:1,choices:[{index:0,delta:{role:"assistant"},finish_reason:null}]})}\n\n`);
          const keepalive=globalThis.setInterval(()=>res.write(": still waiting\n\n"),100);
          res.on("close",()=>globalThis.clearInterval(keepalive));
        }
        return;
      }
      if(name==="primary"&&["fallback","affinity-tool"].includes(last)){res.writeHead(429,{"Content-Type":"application/json"});res.end(JSON.stringify({error:{message:"contract rate limit"}}));return;}
      if((name!=="official"&&last==="http-fallback") || (name==="backup"&&last==="held-identity")){res.writeHead(503,{"Content-Type":"application/json"});res.end(JSON.stringify({error:{message:"contract unavailable"}}));return;}
      assert.equal(body.model,upstreamModel);assert.equal(body.stream_options.include_usage,true);
      res.setHeader("Content-Type","text/event-stream");
      const id=`contract-${name}-${counts[name]}`;
      const chunk=value=>res.write(`data: ${JSON.stringify({id,model:upstreamModel,created:1,object:"chat.completion.chunk",...value})}\n\n`);
      if(last==="partial") {
        chunk({choices:[{index:0,delta:{role:"assistant",content:"partial reply"},finish_reason:null}]});
        const timer=globalThis.setTimeout(()=>res.end(),firstToken*1000+500);res.on("close",()=>globalThis.clearTimeout(timer));return;
      }
      if(last==="tool"||last==="affinity-tool"){
        assert.equal(body.tools[0].function.name,"contract_tool");
        chunk({choices:[{index:0,delta:{tool_calls:[{index:0,id:"tool-contract",type:"function",function:{name:"contract_tool",arguments:'{"ok":'}}]},finish_reason:null}]});
        chunk({choices:[{index:0,delta:{tool_calls:[{index:0,function:{arguments:'true}'}}]},finish_reason:null}]});
      }else chunk({choices:[{index:0,delta:{role:"assistant",content:"contract ok"},finish_reason:null}]});
      chunk({choices:[{index:0,delta:{},finish_reason:last==="tool"?"tool_calls":"stop"}],usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12,prompt_tokens_details:{cached_tokens:3}}});
      res.end("data: [DONE]\n\n");
    }); await new Promise(resolve=>server.listen(port,"127.0.0.1",resolve));servers.push(server);
  };
  await upstream("primary",3499);await upstream("backup",3500);await upstream("official",3501);
  const responses=createServer(async(req,res)=>{
    try {
      if(req.url.endsWith("/models")){res.setHeader("Content-Type","application/json");res.end(JSON.stringify({data:[{id:"gpt-6.1-sol"}]}));return;}
      assert.equal(req.url,"/v1/responses","GPT must never be sent to Chat Completions upstream");
      let raw="";for await(const c of req)raw+=c;const body=JSON.parse(raw);counts.responses++;
      assert.equal(body.reasoning?.effort,"medium","reasoning_effort reaches Responses");assert.equal(body.model,"gpt-6.1-sol");assert.equal(body.stream,true);assert.equal(body.max_output_tokens,32);
      const id=`contract-response-${counts.responses}`;const cancellation=JSON.stringify(body.input).includes("cancel-contract");
      res.setHeader("Content-Type","text/event-stream");
      const event=(type,value)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`);
      event("response.created",{response:{id,model:"gpt-6.1-sol",status:"in_progress",output:[]}});
      if(cancellation){
        event("response.output_text.delta",{output_index:0,content_index:0,item_id:"msg-cancel",delta:"waiting"});
        res.on("close",()=>{cancelledUpstream=true;});return;
      }
      const content=body.input.flatMap(item=>Array.isArray(item.content)?item.content:[]);
      assert.ok(content.some(part=>part.type==="input_image"&&part.image_url===pixel),"image survives Chat to Responses translation");
      assert.equal(body.tools[0].type,"function");assert.equal(body.tools[0].name,"contract_tool");
      const toolOutput=body.input.find(item=>item.type==="function_call_output");
      if(toolOutput){
        assert.equal(toolOutput.call_id,"call-contract");assert.equal(toolOutput.output,'{"result":"verified"}');
        assert.ok(body.input.some(item=>item.type==="function_call"&&item.call_id==="call-contract"&&item.name==="contract_tool"),"tool result keeps its original call identity");
        event("response.output_text.delta",{output_index:0,content_index:0,item_id:"msg-final",delta:"image understood"});
        event("response.completed",{response:{id,model:"gpt-6.1-sol",status:"completed",output:[{id:"msg-final",type:"message",role:"assistant",status:"completed",content:[{type:"output_text",text:"image understood",annotations:[]}]}],usage:{input_tokens:120,output_tokens:4,total_tokens:124,input_tokens_details:{cached_tokens:30}}}});
        res.end();return;
      }
      const item={type:"function_call",id:"fc-contract",call_id:"call-contract",name:"contract_tool",arguments:"",status:"in_progress"};
      event("response.output_item.added",{output_index:0,item});
      event("response.function_call_arguments.delta",{output_index:0,item_id:item.id,delta:'{"ok":true}'});
      const completed={...item,arguments:'{"ok":true}',status:"completed"};
      event("response.function_call_arguments.done",{output_index:0,item_id:item.id,arguments:completed.arguments});
      event("response.output_item.done",{output_index:0,item:completed});
      event("response.completed",{response:{id,model:"gpt-6.1-sol",status:"completed",output:[completed],usage:{input_tokens:110,output_tokens:12,total_tokens:122,input_tokens_details:{cached_tokens:30,cache_write_tokens:20},output_tokens_details:{reasoning_tokens:5}}}});
      res.end();
    } catch(error){upstreamError=error;res.writeHead(500,{"Content-Type":"application/json"});res.end(JSON.stringify({error:{message:"Synthetic upstream contract failed"}}));}
  });
  await new Promise(resolve=>responses.listen(3502,"127.0.0.1",resolve));servers.push(responses);
  const planned=buildAgentGatewayConfig({providers:[],groups:[{id:"riic-agent",name:"riic-agent",members:["riic-gpt/gpt-6.1-sol"],
    match:["riic-gpt/*"],off:["riic-deepseek/test-model","riic-glm/test-model"],routing:"manual",pick:"riic-gpt/gpt-6.1-sol",disabled:true,
    rules:[{member:"riic-gpt/gpt-6.1-sol"}],classifier:"riic-gpt/gpt-6.1-sol",effort:"auto"}]}, {
    AGENT_LLM_DEEPSEEK_API_KEY:"contract-only",AGENT_LLM_DEEPSEEK_BASE_URL:"http://127.0.0.1:3499/v1",AGENT_LLM_DEEPSEEK_MODEL:"test-model",
    AGENT_LLM_GLM_API_KEY:"contract-only",AGENT_LLM_GLM_BASE_URL:"http://127.0.0.1:3500/v1",AGENT_LLM_GLM_MODEL:"test-model",
    AGENT_LLM_GPT_API_KEY:"contract-only",AGENT_LLM_GPT_BASE_URL:"http://127.0.0.1:3502/v1",AGENT_LLM_GPT_MODEL:"gpt-6.1-sol",
    AGENT_GATEWAY_OFFICIAL_FALLBACK_ENABLED:"1",AGENT_LLM_DEEPSEEK_OFFICIAL_API_KEY:"contract-only",
    AGENT_LLM_DEEPSEEK_OFFICIAL_BASE_URL:"https://api.deepseek.com",AGENT_LLM_DEEPSEEK_OFFICIAL_MODEL:"deepseek-flash",
  }).config;
  assert.deepEqual(planned.groups[0].members,["riic-deepseek/test-model","riic-glm/test-model","riic-deepseek-official/deepseek-flash"]);
  // Exercise the deploy migration against the pinned gateway with synthetic
  // upstreams only; the production official-host guard remains strict.
  planned.providers.find(provider=>provider.id==="riic-deepseek-official").chat="http://127.0.0.1:3501/v1";
  planned.groups[0].firstToken=firstToken;
  // A separate synthetic group deterministically crosses Magpie's fixed 15s
  // held-header threshold. The production group above keeps its 10s setting
  // when MAGPIE_CONTRACT_FIRST_TOKEN_SECONDS=10; this 20s case is not a change
  // to the production timeout or evidence of its ordinary fallback timing.
  planned.groups.push({ ...planned.groups[0], id:"riic-held-identity", name:"riic-held-identity", firstToken:20 });
  await writeFile(path.join(cfg,"providers.json"),JSON.stringify(planned));
  await writeFile(path.join(cfg,"plugins.json"),JSON.stringify({plugins:[{spec:process.env.MAGPIE_TEST_PLUGIN,options:{words:["RIIC_FILTER_BLOCK_TEST"],patterns:[],action:"reject",check:"all",message:"RIIC contract policy rejection"}}]}));
  const startGateway=async()=>{
    if(child && child.exitCode===null) {
      const exited=new Promise(resolve=>child.once("exit",resolve));child.kill();await exited;
    }
    child=spawn(process.env.MAGPIE_TEST_BINARY,["serve"],{env:{...process.env,XDG_CONFIG_HOME:dir,XDG_CACHE_HOME:path.join(dir,"cache"),XDG_DATA_HOME:path.join(dir,"data"),XDG_STATE_HOME:path.join(dir,"state"),DO_NOT_TRACK:"1",MAGPIE_ADDR:"127.0.0.1:3498",MAGPIE_NO_ACCOUNTS:"1"},stdio:"ignore",windowsHide:true});
    let ready=false;
    for(let i=0;i<80;i++){try{const r=await globalThis.fetch("http://127.0.0.1:3498/v1/models");if(r.ok){ready=true;break;}}catch{/* Gateway is still starting. */}await delay(250);}
    assert.ok(ready,"gateway starts");
  };
  await startGateway();
  const chat=async(text,model="group/riic-agent",extra={})=>{
    const response=await globalThis.fetch("http://127.0.0.1:3498/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","X-Magpie-Session":`contract-${text}`,"X-Magpie-Response-Model":"member"},body:JSON.stringify({model,messages:[{role:"user",content:text}],stream:true,stream_options:{include_usage:true},max_tokens:32,reasoning_effort:"medium",...extra})});
    return {response,text:await response.text()};
  };
  const normal=await chat("normal");assert.equal(normal.response.status,200);assert.equal(normal.response.headers.get("x-magpie-model"),"riic-deepseek/test-model");assert.match(normal.text,/contract ok/);
  const before=counts.primary+counts.backup+counts.official;const blocked=await chat("RIIC_FILTER_BLOCK_TEST");assert.equal(blocked.response.status,400);assert.equal(counts.primary+counts.backup+counts.official,before,"guard stops before upstream");
  const tool=await chat("tool","riic-deepseek/test-model",{tools:[{type:"function",function:{name:"contract_tool",parameters:{type:"object",properties:{ok:{type:"boolean"}},required:["ok"]}}}]});assert.equal(tool.response.status,200);assert.match(tool.text,/tool-contract/);assert.match(tool.text,/prompt_tokens/);
  const fallback=await chat("fallback");assert.equal(fallback.response.status,200);assert.equal(fallback.response.headers.get("x-magpie-provider"),"riic-glm");assert.equal(fallback.response.headers.get("x-magpie-model"),"riic-glm/test-model");
  const route=await (await globalThis.fetch("http://127.0.0.1:3498/v1/magpie/route?session=contract-fallback")).json();
  assert.ok(route.route.tries.some(t=>t.status===429),"failed fallback attempt retained in routing API");
  await startGateway();
  const affinityTools=[{type:"function",function:{name:"contract_tool",parameters:{type:"object",properties:{ok:{type:"boolean"}},required:["ok"]}}}];
  const affinityStart=await chat("affinity-tool","group/riic-agent",{tools:affinityTools});
  assert.equal(affinityStart.response.headers.get("x-magpie-provider"),"riic-glm");
  const affinityMessages=[{role:"user",content:"affinity-tool"},{role:"assistant",content:null,tool_calls:[{id:"tool-contract",type:"function",function:{name:"contract_tool",arguments:'{"ok":true}'}}]},
    {role:"tool",tool_call_id:"tool-contract",content:'{"result":"verified"}'}];
  // Remove the primary's transient cooldown while preserving persisted turn affinity.
  await startGateway();
  const beforeContinuation={...counts};
  const affinityContinue=await chat("affinity-tool","group/riic-agent",{messages:affinityMessages,tools:affinityTools});
  assert.equal(affinityContinue.response.headers.get("x-magpie-provider"),"riic-glm","tool continuation stays on the answering route");
  assert.equal(counts.primary,beforeContinuation.primary,"same-turn continuation does not retry the primary");
  const nextTurn=await chat("affinity-tool","group/riic-agent",{messages:[...affinityMessages,{role:"assistant",content:"contract ok"},{role:"user",content:"next turn"}]});
  assert.equal(nextTurn.response.headers.get("x-magpie-provider"),"riic-deepseek","a new user turn returns to the healthy primary");
  for(const text of ["timeout-fallback","keepalive-fallback","http-fallback"]) {
    // Each failure case starts without the previous case's circuit cooldown.
    await startGateway();
    const before={...counts};const started=Date.now();
    const result=await chat(text);
    assert.equal(result.response.status,200);assert.match(result.text,/contract ok/);
    const members=result.text.split("\n").filter(line=>line.startsWith("data: {")).map(line=>JSON.parse(line.slice(6)).model).filter(Boolean);
    assert.ok(members.length>0,`${text}: answering member is present in SSE`);
    assert.ok(members.every(member=>member==="riic-deepseek-official/deepseek-flash"),`${text}: SSE identifies the final answering member`);
    for(const name of ["primary","backup","official"])assert.equal(counts[name]-before[name],1,`${text}: ${name} attempted once`);
    assert.ok(Date.now()-started<firstToken*2000+6000,"both unresponsive upstreams are bounded");
    const data=await (await globalThis.fetch(`http://127.0.0.1:3498/v1/magpie/route?session=contract-${text}`)).json();
    assert.ok(data.route.tries.length>=3,"all three attempts are retained");
    assert.equal(data.route.model,"riic-deepseek-official/deepseek-flash");
  }
  await startGateway();
  const beforeHeld={...counts};let heldHeaders;
  const sdkGateway=createOpenAICompatible({name:"contract-magpie",baseURL:"http://127.0.0.1:3498/v1",apiKey:"contract-only",includeUsage:true,
    headers:{"X-Magpie-Session":"contract-held-identity","X-Magpie-Response-Model":"member"},
    fetch:async(input,init)=>{const response=await globalThis.fetch(input,init);heldHeaders=response.headers;return response;}});
  const held=streamText({model:sdkGateway.chatModel("group/riic-held-identity"),prompt:"held-identity",maxOutputTokens:32,maxRetries:0});
  assert.equal(await held.text,"contract ok");
  assert.equal(heldHeaders.get("x-magpie-model"),"riic-deepseek/test-model","held keepalive commits the early primary HTTP identity");
  assert.equal((await held.response).modelId,"riic-deepseek-official/deepseek-flash","real SDK metadata uses the final member despite early headers");
  for(const name of ["primary","backup","official"])assert.equal(counts[name]-beforeHeld[name],1,`held-identity: ${name} attempted once`);
  const heldRoute=await (await globalThis.fetch("http://127.0.0.1:3498/v1/magpie/route?session=contract-held-identity")).json();
  assert.equal(heldRoute.route.model,"riic-deepseek-official/deepseek-flash");
  await startGateway();
  const recovered=await chat("recovered");assert.equal(recovered.response.headers.get("x-magpie-provider"),"riic-deepseek","healthy primary is preferred when no circuit cooldown applies");
  const beforePartial={...counts};const partial=await chat("partial");
  assert.equal(partial.response.headers.get("x-magpie-provider"),"riic-deepseek");assert.match(partial.text,/partial reply/);
  assert.equal(counts.backup,beforePartial.backup);assert.equal(counts.official,beforePartial.official,"partial output is never replayed");
  const backupBefore=counts.backup;
  const explicit=await chat("fallback","riic-deepseek/test-model");assert.equal(explicit.response.status,429);assert.equal(counts.backup,backupBefore,"an explicit model must not fall back to another provider");
  assert.equal(counts.responses,0,"migrated default group never dispatches or classifies through GPT");
  const vision=await chat("vision","riic-gpt/gpt-6.1-sol",{messages:[{role:"user",content:[{type:"text",text:"Read this image and call contract_tool"},{type:"image_url",image_url:{url:pixel,detail:"high"}}]}],tools:[{type:"function",function:{name:"contract_tool",parameters:{type:"object",properties:{ok:{type:"boolean"}},required:["ok"]}}}]});
  if(upstreamError)throw upstreamError;
  assert.equal(vision.response.status,200);assert.equal(vision.response.headers.get("x-magpie-provider"),"riic-gpt");assert.equal(vision.response.headers.get("x-magpie-model"),"riic-gpt/gpt-6.1-sol");
  assert.match(vision.text,/call-contract/);assert.match(vision.text,/contract_tool/);
  const visionChunks=vision.text.split("\n").filter(line=>line.startsWith("data: {")).map(line=>JSON.parse(line.slice(6)));
  const visionUsage=visionChunks.find(chunk=>chunk.usage)?.usage;
  assert.equal(visionUsage.prompt_tokens,110);assert.equal(visionUsage.completion_tokens,12);assert.equal(visionUsage.prompt_tokens_details.cached_tokens,30);
  assert.equal(visionUsage.prompt_tokens_details.cache_write_tokens,20,"Responses cache writes survive Chat translation");
  assert.equal(visionUsage.total_tokens,122,"cache writes are already included in prompt and total tokens");
  assert.equal(visionUsage.completion_tokens_details.reasoning_tokens,5,"reasoning is a subset of the output total");
  const toolDeltas=visionChunks.flatMap(chunk=>chunk.choices??[]).flatMap(choice=>choice.delta?.tool_calls??[]);
  assert.equal(toolDeltas.find(call=>call.id)?.id,"call-contract");
  assert.equal(toolDeltas.map(call=>call.function?.arguments??"").join(""),'{"ok":true}');
  const followup=await chat("vision-followup","riic-gpt/gpt-6.1-sol",{messages:[{role:"user",content:[{type:"text",text:"Read this image and call contract_tool"},{type:"image_url",image_url:{url:pixel}}]},
    {role:"assistant",content:null,tool_calls:[{id:"call-contract",type:"function",function:{name:"contract_tool",arguments:'{"ok":true}'}}]},
    {role:"tool",tool_call_id:"call-contract",content:'{"result":"verified"}'}],tools:[{type:"function",function:{name:"contract_tool",parameters:{type:"object",properties:{ok:{type:"boolean"}},required:["ok"]}}}]});
  if(upstreamError)throw upstreamError;
  assert.equal(followup.response.status,200);assert.match(followup.text,/image understood/);
  const cancel=new globalThis.AbortController();
  const cancelled=await globalThis.fetch("http://127.0.0.1:3498/v1/chat/completions",{method:"POST",signal:cancel.signal,headers:{"Content-Type":"application/json","X-Magpie-Session":"contract-cancel"},body:JSON.stringify({model:"riic-gpt/gpt-6.1-sol",messages:[{role:"user",content:"cancel-contract"}],stream:true,stream_options:{include_usage:true},max_tokens:32,reasoning_effort:"medium"})});
  const cancelReader=cancelled.body.getReader();await cancelReader.read();cancel.abort();await cancelReader.cancel().catch(()=>{});
  for(let i=0;i<40&&!cancelledUpstream;i++)await delay(50);
  assert.ok(cancelledUpstream,"downstream cancellation closes the Responses request");
  await delay(500);
  const usage=await (await globalThis.fetch("http://127.0.0.1:3498/v1/magpie/usage/requests?limit=100&period=all")).json();
  const row=usage.rows.find(r=>r.session==="contract-normal"&&r.status===200);
  assert.equal(row.in,7);assert.equal(row.cache_read,3);assert.equal(row.out,2);assert.ok(row.response_id);assert.equal(row.priced,false);
  const visionRow=usage.rows.find(r=>r.session==="contract-vision"&&r.status===200);
  assert.ok(visionRow,"Responses call is imported into gateway usage");assert.equal(visionRow.in,60);assert.equal(visionRow.cache_read,30);assert.equal(visionRow.cache_write,20);assert.equal(visionRow.out,12);assert.match(visionRow.response_id,/contract-response-/);
  assert.equal(visionRow.in+visionRow.cache_read+visionRow.cache_write,visionUsage.prompt_tokens,"ledger input partitions reconstruct the Chat total");
  console.log(JSON.stringify({passed:true,checks:["managed group upgrade clears legacy routing controls","identity headers","stream usage and cache partition","tool call deltas","input guard rejects before upstream","429 fallback","same-turn affinity and next-turn reset","two 503 failures reach third model","two no-header timeouts reach third model","role and keepalive-only streams reach third model","final SDK member identity survives early primary headers (synthetic 20s threshold)","primary recovery","partial output is not replayed","failed attempt ledger","explicit selection has no fallback","Responses image and tool bridge","Responses tool-result continuation","Responses usage and cache partition","Responses cache writes survive Chat and ledger","Responses cancellation","reasoning effort mapping"],version:"0.1.1203"}));
} finally {
  if(child&&child.exitCode===null){const exited=once(child,"exit");child.kill();await exited;}
  await Promise.all(servers.map(server=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);})));
  if(path.dirname(dir)===path.resolve(tmpdir())&&path.basename(dir).startsWith("riic-magpie-contract-")) await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
