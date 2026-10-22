import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { register, registerHooks } from "node:module";
import test from "node:test";
import process from "node:process";
import { URL, URLSearchParams } from "node:url";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
register("../../../../../scripts/ts-path-loader.mjs", import.meta.url);
registerHooks({ resolve(specifier, context, next) { return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context); } });
const url = process.env.AUTH_INTEGRATION_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test")) throw new Error("Isolated *_test database required");
process.env.DATABASE_URL = url;
const { getDatabasePool } = await import("@riic/platform-server/db");
const accounting = await import("./agent-accounting.ts");
const admin = await import("./admin.ts");
const { getWallet, createAgentUsage, finalizeAgentUsage, chargeAgentTool, refundFailedAgentTool, listUsage, listLedger } = await import("./service.ts");

test("durable reservations, settlement, refunds and policy concurrency", async () => {
  const pool = getDatabasePool(); const userId = `agent-test-${randomUUID()}`; const actor = `agent-admin-${randomUUID()}`;
  try {
    for (const id of [userId,actor]) await pool.query('INSERT INTO public."user" (id,name,email,role) VALUES ($1,$1,$2,$3)',[id,`${id}@example.test`,id===actor?"admin":"user"]);
    await pool.query("INSERT INTO app.billing_wallet (user_id,paid_points) VALUES ($1,50)",[userId]);
    const policies = await accounting.activeAgentPolicies();
    // Keep the fixture deterministic across wall-clock peak/off-peak boundaries.
    delete policies.rates.policy.models[0].peak;
    const begin = (key=randomUUID()) => accounting.beginAgentRun({userId,conversationId:`test-${key}`,idempotencyKey:key,requestHash:"test-hash",rates:policies.rates,filterVersion:policies.filter.id});
    const key=randomUUID(); const duplicates=await Promise.allSettled([begin(key),begin(key),begin(key)]);
    assert.equal(duplicates.filter(r=>r.status==="fulfilled").length,1);
    const run=duplicates.find(r=>r.status==="fulfilled").value;
    const call=await accounting.beginModelCall(run,0,2000,2048);
    assert.ok((await getWallet(userId)).reservedPoints > 0 && (await getWallet(userId)).reservedPoints < 1);
    const callUsage={id:call.id,provider:"riic-deepseek",model:"deepseek-v4.1-flash",usage:{inputTokens:1000,cachedInputTokens:100,outputTokens:100}};
    await Promise.all([accounting.finishModelCall(callUsage),accounting.finishModelCall(callUsage)]);
    const firstTool=await accounting.beginToolCharge(run,"tool-id","solve_schedule");
    await assert.rejects(accounting.beginToolCharge(run,"tool-id","solve_schedule"));
    await accounting.finishToolCharge(firstTool,true);await accounting.finishToolCharge(firstTool,true);
    await Promise.all([accounting.settleAgentRun(run,"completed"),accounting.settleAgentRun(run,"completed")]);
    assert.equal((await getWallet(userId)).paidPoints,48.9844);
    assert.equal((await getWallet(userId)).reservedPoints,0);
    const ledger=(await pool.query("SELECT * FROM app.billing_ledger WHERE reference_id=$1 AND kind='agent_settlement'",[run])).rows;
    assert.equal(ledger.length,1);assert.equal(Number(ledger[0].points_delta),-1.0156);
    assert.equal(ledger[0].metadata.tokenPoints,0.0156);
    assert.equal(ledger[0].metadata.toolPoints,1);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM app.agent_usage WHERE id=$1",[run])).rows[0].n,1);
    const refund={userId,action:"refund",referenceId:ledger[0].id,points:0.0156,reason:"integration refund",idempotencyKey:randomUUID()};
    await Promise.all([admin.adjustBilling(actor,refund),admin.adjustBilling(actor,refund)]);
    assert.equal((await getWallet(userId)).paidPoints,49);
    await admin.adjustBilling(actor,{...refund,idempotencyKey:randomUUID(),points:1});
    assert.equal((await getWallet(userId)).paidPoints,50);
    await assert.rejects(admin.adjustBilling(actor,{...refund,idempotencyKey:randomUUID(),points:0.0001}));
    await assert.rejects(admin.adjustBilling(actor,{...refund,idempotencyKey:randomUUID(),points:0.00001}));
    await assert.rejects(admin.adjustBilling(actor,{...refund,points:1}));

    // Two simultaneous calls compete for a fractional balance; only one can reserve it.
    await pool.query("UPDATE app.billing_wallet SET paid_points=0.2 WHERE user_id=$1",[userId]);
    const r1=await begin();const r2=await begin();
    const competing=await Promise.allSettled([accounting.beginModelCall(r1,0,0,100),accounting.beginModelCall(r2,0,0,100)]);
    assert.equal(competing.filter(r=>r.status==="fulfilled").length,1);
    await Promise.all([accounting.settleAgentRun(r1,"failed"),accounting.settleAgentRun(r2,"failed")]);
    assert.equal((await getWallet(userId)).paidPoints,0.2); assert.equal((await getWallet(userId)).reservedPoints,0);
    assert.ok((await pool.query("SELECT id FROM app.billing_review WHERE run_id=any($1::text[])",[[r1,r2]])).rowCount>0);

    // Failed tools cost nothing. Unknown usage never becomes a fabricated zero-token record.
    await pool.query("UPDATE app.billing_wallet SET paid_points=1 WHERE user_id=$1",[userId]);
    const failed=await begin(); const failedTool=await accounting.beginToolCharge(failed,"failed-tool","solve_schedule");
    await accounting.finishToolCharge(failedTool,false); await accounting.settleAgentRun(failed,"completed");
    assert.equal((await getWallet(userId)).paidPoints,1);

    // A monthly reservation expiring during a run is released as expired, not spendable.
    const expiry=new Date(Date.now()+60_000);
    await pool.query("UPDATE app.billing_wallet SET paid_points=20,monthly_points=10,monthly_expires_at=$2 WHERE user_id=$1",[userId,expiry]);
    const monthly=await begin(); const monthlyCall=await accounting.beginModelCall(monthly,0,120_000,2048);
    const reserved=(await getWallet(userId)).reservedPoints;assert.ok(reserved>1);
    await pool.query("UPDATE app.billing_wallet SET monthly_expires_at=now()-interval '1 second' WHERE user_id=$1",[userId]);
    await pool.query("UPDATE app.agent_run SET monthly_expires_at=now()-interval '1 second' WHERE id=$1",[monthly]);
    await getWallet(userId);
    assert.equal(Number((await pool.query("SELECT monthly_points FROM app.billing_wallet WHERE user_id=$1",[userId])).rows[0].monthly_points),reserved);
    await accounting.finishModelCall({...callUsage,id:monthlyCall.id});
    await accounting.settleAgentRun(monthly,"completed");
    assert.equal((await getWallet(userId)).monthlyPoints,0); assert.equal((await getWallet(userId)).paidPoints,20);
    assert.equal(Number((await pool.query("SELECT monthly_points FROM app.billing_wallet WHERE user_id=$1",[userId])).rows[0].monthly_points),0);
    const monthlyLedger=(await pool.query("SELECT id FROM app.billing_ledger WHERE reference_id=$1 AND kind='agent_settlement'",[monthly])).rows[0];
    const expired=await admin.adjustBilling(actor,{...refund,referenceId:monthlyLedger.id,points:0.0156,idempotencyKey:randomUUID()});
    assert.equal(expired.expiredPoints,0.0156);assert.equal((await getWallet(userId)).paidPoints,20);

    const stale=await begin();await accounting.beginModelCall(stale,0,0,100);
    await pool.query("UPDATE app.agent_run SET created_at=now()-interval '20 minutes' WHERE id=$1",[stale]);
    assert.ok(await accounting.recoverAgentRuns());assert.equal((await getWallet(userId)).reservedPoints,0);

    const draft=await admin.changeAgentPolicy(actor,{kind:"rates",action:"draft",payload:policies.rates.policy,expectedActive:policies.rates.id,reason:"test draft"});
    const publications=await Promise.allSettled([1,2].map(()=>admin.changeAgentPolicy(actor,{kind:"rates",action:"publish",id:draft.id,expectedActive:policies.rates.id,reason:"test publish"})));
    assert.equal(publications.filter(r=>r.status==="fulfilled").length,1);
    assert.equal((await pool.query("SELECT rate_version FROM app.agent_run WHERE id=$1",[run])).rows[0].rate_version,policies.rates.id);
    assert.ok((await admin.billingRunDetail(run)).calls.length===1);
    assert.ok((await admin.listBilling("wallets",new URLSearchParams({q:userId}))).total===1);
    assert.ok((await admin.billingOverview(new Date(Date.now()-86400_000),new Date())).runs>0);

    // Exercise the real AI SDK + gateway middleware, including a tool step and a split blocked word.
    const { streamText, tool, stepCountIs } = await import("ai");
    const { z } = await import("zod");
    const { createGatewayRun } = await import("../agent/gateway-runtime.ts");
    const { withAgentAnswerBoundary } = await import("../agent/answer-boundary.ts");
    const { compileFilterPolicy } = await import("../agent/filter-policy.ts");
    let step=0; let route; let corruptAnswer=false; const gatewayRows=[]; const routeBase=Date.now();
    const sdkKey=randomUUID();const sdkSession=accounting.agentSessionId(userId,`test-${sdkKey}`);
    const policyDir=await mkdtemp(path.join(tmpdir(),"riic-gateway-test-"));
    const gateway=createServer(async(req,res)=>{
      if(req.url.startsWith("/v1/magpie/usage/requests")){res.setHeader("Content-Type","application/json");res.end(JSON.stringify({rows:gatewayRows,total:gatewayRows.length}));return;}
      if(req.url.startsWith("/v1/magpie/route")){res.setHeader("Content-Type","application/json");res.end(JSON.stringify({route}));return;}
      let raw="";for await(const c of req)raw+=c;const request=JSON.parse(raw);
      assert.equal(request.model,"group/riic-agent");assert.equal(request.max_tokens,2048);
      step++;route={id:routeBase+step,time:new Date().toISOString(),model:"riic-deepseek/deepseek-v4.1-flash",tries:[{model:"riic-deepseek/deepseek-v4.1-flash",status:200,done:true}]};
      gatewayRows.push({t:route.time,route_id:route.id,session:sdkSession,provider:"riic-deepseek",model:"deepseek-v4.1-flash",response_id:`sdk-${sdkKey}-${step}`,in:7,out:2,cache_read:3,status:200,priced:false});
      res.writeHead(200,{"Content-Type":"text/event-stream","X-Magpie-Provider":"riic-deepseek","X-Magpie-Model":"riic-deepseek/deepseek-v4.1-flash"});
      const chunk=c=>res.write(`data: ${JSON.stringify({id:`sdk-${sdkKey}-${step}`,model:"deepseek-v4.1-flash",created:1,object:"chat.completion.chunk",...c})}\n\n`);
      if(step===1)chunk({choices:[{index:0,delta:{tool_calls:[{index:0,id:"sdk-tool",type:"function",function:{name:"solve",arguments:'{"ok":true}'}}]},finish_reason:null}]});
      else for(const content of corruptAnswer ? ["[[sys", "tem]] internal"] : ["safe RIIC_FILTER_","BLOCK_TEST safe"])chunk({choices:[{index:0,delta:{content},finish_reason:null}]});
      chunk({choices:[{index:0,delta:{},finish_reason:step===1?"tool_calls":"stop"}],usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12,prompt_tokens_details:{cached_tokens:3}}});res.end("data: [DONE]\n\n");
    });
    await new Promise(resolve=>gateway.listen(0,"127.0.0.1",resolve));
    process.env.AGENT_GATEWAY_URL=`http://127.0.0.1:${gateway.address().port}/v1`;process.env.AGENT_GATEWAY_KEY="test-only";
    try {
      const sdkRun=await begin(sdkKey);
      const runtime=createGatewayRun({runId:sdkRun,sessionId:sdkSession,requestId:sdkRun,userId,filterVersion:policies.filter.id,filter:compileFilterPolicy(policies.filter.policy)});
      const result=streamText({model:withAgentAnswerBoundary(runtime.model,runtime.deliver),maxRetries:0,maxOutputTokens:2048,messages:[{role:"user",content:"test tool then answer"}],stopWhen:stepCountIs(3),tools:{solve:tool({inputSchema:z.object({ok:z.boolean()}),execute:async(_,options)=>{const id=await accounting.beginToolCharge(sdkRun,options.toolCallId,"solve_schedule");await accounting.finishToolCharge(id,true);return {ok:true};}})},onFinish:()=>runtime.finalize("completed")});
      assert.equal(await result.text,"safe *** safe");
      await runtime.finalize("completed");
      const sdkDetail=await admin.billingRunDetail(sdkRun);assert.equal(sdkDetail.calls.length,2);assert.equal(sdkDetail.run.charged_points,1.0004);assert.ok(sdkDetail.calls.every(c=>c.status==="measured"&&c.input_tokens===10&&c.cached_input_tokens===3));
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM app.agent_filter_event WHERE request_id=$1",[sdkRun])).rows[0].n,1);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM app.agent_gateway_usage WHERE call_id=any($1::text[])",[sdkDetail.calls.map(c=>c.id)])).rows[0].n,2);
      process.env.AGENT_GATEWAY_POLICY_DIR=policyDir;
      const {maintainAgentGateway}=await import("../agent/gateway-maintenance.ts");
      assert.equal((await maintainAgentGateway()).imported,2);assert.equal((await maintainAgentGateway()).imported,0);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM app.agent_gateway_usage WHERE call_id=any($1::text[])",[sdkDetail.calls.map(c=>c.id)])).rows[0].n,4);
      assert.equal((await pool.query("SELECT status FROM app.agent_gateway_status WHERE id='gateway'")).rows[0].status,"healthy");
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM app.billing_review WHERE run_id=$1 AND kind='gateway_usage_mismatch'",[sdkRun])).rows[0].n,0);
      corruptAnswer=true;
      const blockedRun=await begin();
      const blockedRuntime=createGatewayRun({runId:blockedRun,sessionId:sdkSession,requestId:blockedRun,userId,filterVersion:policies.filter.id,filter:compileFilterPolicy(policies.filter.policy)});
      const blockedResult=streamText({model:withAgentAnswerBoundary(blockedRuntime.model,blockedRuntime.deliver),maxRetries:0,maxOutputTokens:2048,prompt:"format guard",onError:()=>blockedRuntime.finalize("failed"),onFinish:()=>blockedRuntime.finalize("completed")});
      const blockedChunks=await Array.fromAsync(blockedResult.toUIMessageStream({onError:()=>"format error"}));
      await blockedRuntime.finalize("failed");
      assert.equal(blockedChunks.filter(part=>part.type==="text-delta").length,0);
      const blockedDetail=await admin.billingRunDetail(blockedRun);
      assert.equal(blockedDetail.run.charged_points,0);
      assert.equal(blockedDetail.calls[0].status,"measured");
      assert.equal((await getWallet(userId)).reservedPoints,0);
    } finally { await new Promise(resolve=>gateway.close(resolve)); if(path.dirname(policyDir)===path.resolve(tmpdir())&&path.basename(policyDir).startsWith("riic-gateway-test-"))await rm(policyDir,{recursive:true,force:true}); }
    // The direct-provider rollback path must retain fractional fees and refund failed solvers.
    await pool.query("UPDATE app.billing_wallet SET paid_points=2,monthly_points=0.1234,monthly_expires_at=now()+interval '1 day' WHERE user_id=$1",[userId]);
    const direct = await createAgentUsage({userId,toolName:"agent_chat",idempotencyKey:randomUUID()});
    await Promise.all([1,2].map(()=>finalizeAgentUsage({usageId:direct,chargedPoints:0.0156,upstreamCostRmbFen:0.1302,chargedCostRmbFen:0.15624})));
    assert.equal((await getWallet(userId)).monthlyPoints,0.1078);
    assert.equal((await getWallet(userId)).paidPoints,2);
    const directUsage=(await listUsage(userId)).find(row=>row.id===direct);
    assert.equal(directUsage.points,0.0156);
    assert.equal(directUsage.chargedCostRmbFen,0.156);
    const failedDirect=await chargeAgentTool({userId,toolName:"solve_schedule",points:1,idempotencyKey:randomUUID()});
    assert.equal((await getWallet(userId)).paidPoints,1.1078);
    await Promise.all([refundFailedAgentTool(failedDirect.usageId),refundFailedAgentTool(failedDirect.usageId)]);
    assert.equal((await getWallet(userId)).paidPoints,2);
    assert.equal((await getWallet(userId)).monthlyPoints,0.1078);
    const failedDebit=(await listLedger(userId)).find(row=>row.referenceId===failedDirect.usageId&&row.kind==="tool_charge");
    await assert.rejects(admin.adjustBilling(actor,{...refund,referenceId:failedDebit.id,points:1,idempotencyKey:randomUUID()}));
    // No floating-point residue after many small debit/refund cycles.
    for (let index=0;index<10;index++) {
      const usageId=await createAgentUsage({userId,toolName:"agent_chat",idempotencyKey:randomUUID()});
      await finalizeAgentUsage({usageId,chargedPoints:0.0001});
    }
    assert.equal((await getWallet(userId)).totalPoints,2.1068);
    assert.equal((await getWallet(userId)).reservedPoints,0);
  } finally {
    await pool.query('DELETE FROM public."user" WHERE id=any($1::text[])',[[userId,actor]]);
    await pool.end();
  }
});
