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
const { defaultRatePolicy } = await import("./rate-policy.ts");
const { calculateAgentTokenCost } = await import("./pricing.ts");
const { getWallet, createAgentUsage, finalizeAgentUsage, chargeAgentTool, refundFailedAgentTool, listUsage, listLedger } = await import("./service.ts");

test("durable reservations, settlement, refunds and policy concurrency", async () => {
  const originalEnv = { ...process.env };
  process.env.AGENT_GATEWAY_MODELS = "deepseek,glm";
  process.env.AGENT_LLM_DEEPSEEK_MODEL = "deepseek-v4.1-flash";
  process.env.AGENT_LLM_GLM_MODEL = "glm-5.3-flash";
  process.env.AGENT_LLM_DEEPSEEK_OFFICIAL_MODEL = "deepseek-flash";
  process.env.AGENT_GATEWAY_OFFICIAL_FALLBACK_ENABLED = "0";
  const pool = getDatabasePool(); const userId = `agent-test-${randomUUID()}`; const actor = `agent-admin-${randomUUID()}`;
  try {
    for (const id of [userId,actor]) await pool.query('INSERT INTO public."user" (id,name,email,role) VALUES ($1,$1,$2,$3)',[id,`${id}@example.test`,id===actor?"admin":"user"]);
    await pool.query("INSERT INTO app.billing_wallet (user_id,paid_points) VALUES ($1,50)",[userId]);
    const originalRates = (await pool.query("SELECT * FROM app.agent_policy_version WHERE kind='rates' ORDER BY version")).rows;
    const initial = await admin.getAgentPolicies();
    assert.equal(initial.initialRates.markup, "");
    assert.deepEqual((await pool.query("SELECT * FROM app.agent_policy_version WHERE kind='rates' ORDER BY version")).rows, originalRates, "opening the editor never creates or changes a rate version");
    const previousActive = originalRates.find(row => row.status === "active");
    if (!previousActive) await assert.rejects(accounting.activeAgentPolicies(), error => error instanceof accounting.AgentAccountingError && error.code === "policy_unavailable");
    await assert.rejects(admin.changeAgentPolicy(actor, { kind: "rates", action: "draft", payload: initial.initialRates, expectedActive: previousActive?.id ?? null, reason: "missing multiplier" }));
    const bootstrap = await admin.changeAgentPolicy(actor, { kind: "rates", action: "draft", payload: defaultRatePolicy("1.2"), expectedActive: previousActive?.id ?? null, reason: "explicit test rates" });
    if (!previousActive) await assert.rejects(accounting.activeAgentPolicies(), error => error instanceof accounting.AgentAccountingError && error.code === "policy_unavailable");
    await admin.changeAgentPolicy(actor, { kind: "rates", action: "publish", id: bootstrap.id, expectedActive: previousActive?.id ?? null, reason: "publish explicit test rates" });
    const policies = await accounting.activeAgentPolicies();
    assert.equal(policies.rates.id, bootstrap.id);
    const publishedPayload = (await pool.query("SELECT payload FROM app.agent_policy_version WHERE id=$1", [bootstrap.id])).rows[0].payload;
    await admin.getAgentPolicies(); await accounting.activeAgentPolicies();
    assert.deepEqual((await pool.query("SELECT payload FROM app.agent_policy_version WHERE id=$1", [bootstrap.id])).rows[0].payload, publishedPayload, "runtime and editor reads preserve published rates");
    // Keep the fixture deterministic across wall-clock peak/off-peak boundaries.
    delete policies.rates.policy.models[0].peak;
    delete policies.rates.policy.models[2].peak;
    const begin = (key=randomUUID()) => accounting.beginAgentRun({userId,conversationId:`test-${key}`,idempotencyKey:key,requestHash:"test-hash",rates:policies.rates,filterVersion:policies.filter.id});
    const key=randomUUID(); const duplicates=await Promise.allSettled([begin(key),begin(key),begin(key)]);
    assert.equal(duplicates.filter(r=>r.status==="fulfilled").length,1);
    const run=duplicates.find(r=>r.status==="fulfilled").value;
    const call=await accounting.beginModelCall(run,0,2000,2048);
    assert.ok((await getWallet(userId)).reservedPoints > 0 && (await getWallet(userId)).reservedPoints < 1);
    // Calls already running during rollout may still have nullable legacy details.
    await pool.query("UPDATE app.agent_model_call SET details=NULL WHERE id=$1",[call.id]);
    const callUsage={id:call.id,provider:"riic-deepseek",model:"deepseek-v4.1-flash",usage:{inputTokens:1000,cachedInputTokens:100,outputTokens:100}};
    await Promise.all([accounting.finishModelCall(callUsage),accounting.finishModelCall(callUsage)]);
    assert.deepEqual((await pool.query("SELECT details FROM app.agent_model_call WHERE id=$1",[call.id])).rows[0].details,{reason:null});
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
    const supplementalRun = await begin();
    const supplementalCall = await accounting.beginModelCall(supplementalRun, 0, 2000, 2048);
    await accounting.finishModelCall({ id: supplementalCall.id, provider: "riic-deepseek-official", model: "deepseek-flash",
      usage: { inputTokens: 1000, cachedInputTokens: 100, outputTokens: 100 } });
    await accounting.settleAgentRun(supplementalRun, "completed");
    const supplementalDetail = await admin.billingRunDetail(supplementalRun);
    assert.equal(supplementalDetail.calls[0].status, "measured");
    assert.equal(supplementalDetail.calls[0].provider, "riic-deepseek-official");
    assert.equal(Number(supplementalDetail.calls[0].upstream_rmb), 0.001302);
    assert.equal(Number(supplementalDetail.calls[0].charged_rmb), 0.0015624);
    assert.equal(supplementalDetail.run.charged_points, 0.0156);
    assert.equal((await getWallet(userId)).reservedPoints, 0);
    const refund={userId,action:"refund",referenceId:ledger[0].id,points:0.0156,reason:"integration refund",idempotencyKey:randomUUID()};
    await Promise.all([admin.adjustBilling(actor,refund),admin.adjustBilling(actor,refund)]);
    assert.equal((await getWallet(userId)).paidPoints,48.9844);
    await admin.adjustBilling(actor,{...refund,idempotencyKey:randomUUID(),points:1});
    assert.equal((await getWallet(userId)).paidPoints,49.9844);
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

    const frozenRun = await begin();
    const draft=await admin.changeAgentPolicy(actor,{kind:"rates",action:"draft",payload:{...policies.rates.policy,markup:"1.75"},expectedActive:policies.rates.id,reason:"test draft"});
    const publications=await Promise.allSettled([1,2].map(()=>admin.changeAgentPolicy(actor,{kind:"rates",action:"publish",id:draft.id,expectedActive:policies.rates.id,reason:"test publish"})));
    assert.equal(publications.filter(r=>r.status==="fulfilled").length,1);
    const supplementalEnabled = process.env.AGENT_GATEWAY_OFFICIAL_FALLBACK_ENABLED;
    try {
      process.env.AGENT_GATEWAY_OFFICIAL_FALLBACK_ENABLED = "1";
      const legacyPolicy = { ...policies.rates.policy, models: policies.rates.policy.models.slice(0, 2) };
      const activeId = publications.find(result => result.status === "fulfilled").value.id;
      const legacyDraft = await admin.changeAgentPolicy(actor, { kind: "rates", action: "draft", payload: legacyPolicy, expectedActive: activeId, reason: "legacy fixture" });
      await assert.rejects(admin.changeAgentPolicy(actor, { kind: "rates", action: "publish", id: legacyDraft.id, expectedActive: activeId, reason: "must retain supplemental model" }), /未完整配置/);
      await assert.rejects(admin.changeAgentPolicy(actor, { kind: "rates", action: "rollback", id: legacyDraft.id, expectedActive: activeId, reason: "must retain supplemental model" }), /未完整配置/);
      assert.equal((await accounting.activeAgentPolicies()).rates.id, activeId);
    } finally {
      if (supplementalEnabled === undefined) delete process.env.AGENT_GATEWAY_OFFICIAL_FALLBACK_ENABLED;
      else process.env.AGENT_GATEWAY_OFFICIAL_FALLBACK_ENABLED = supplementalEnabled;
    }
    const frozenCall = await accounting.beginModelCall(frozenRun, 0, 2000, 2048);
    await accounting.finishModelCall({ ...callUsage, id: frozenCall.id });
    await accounting.settleAgentRun(frozenRun, "completed");
    assert.equal((await admin.billingRunDetail(frozenRun)).run.charged_points, 0.0156);
    const updatedRates = (await accounting.activeAgentPolicies()).rates;
    assert.equal(updatedRates.policy.markup, "1.75");
    const updatedRun = await accounting.beginAgentRun({ userId, conversationId: `test-${randomUUID()}`, idempotencyKey: randomUUID(), requestHash: "updated-rate-test", rates: updatedRates, filterVersion: policies.filter.id });
    const updatedCall = await accounting.beginModelCall(updatedRun, 0, 2000, 2048);
    await accounting.finishModelCall({ ...callUsage, id: updatedCall.id });
    await accounting.settleAgentRun(updatedRun, "completed");
    assert.equal((await admin.billingRunDetail(updatedRun)).run.charged_points, 0.0228);
    assert.equal((await pool.query("SELECT rate_version FROM app.agent_run WHERE id=$1",[run])).rows[0].rate_version,policies.rates.id);
    assert.equal((await admin.billingRunDetail(run)).run.policy.markup, "1.2");
    assert.equal(Number((await pool.query("SELECT points_delta FROM app.billing_ledger WHERE id=$1", [ledger[0].id])).rows[0].points_delta), -1.0156);
    assert.ok((await admin.billingRunDetail(run)).calls.length===1);
    assert.ok((await admin.listBilling("wallets",new URLSearchParams({q:userId}))).total===1);
    assert.ok((await admin.billingOverview(new Date(Date.now()-86400_000),new Date())).runs>0);

    // Exercise the real AI SDK + gateway middleware, including a tool step and a split blocked word.
    const { streamText, tool, stepCountIs } = await import("ai");
    const { z } = await import("zod");
    const { createGatewayRun } = await import("../agent/gateway-runtime.ts");
    const { withAgentAnswerBoundary } = await import("../agent/answer-boundary.ts");
    const { compileFilterPolicy } = await import("../agent/filter-policy.ts");
    const { defaultModelPolicy } = await import("../agent/model-policy.ts");
    const selection={...defaultModelPolicy().models.find(row=>row.id==="deepseek"),provider:"riic-deepseek",model:"deepseek-v4.1-flash",vision:false,protocol:"chat",policyVersion:"models:test"};
    let step=0; let route; let corruptAnswer=false; let returnedModel=selection.model; const gatewayRows=[]; const routeBase=Date.now();
    const sdkKey=randomUUID();const sdkSession=accounting.agentSessionId(userId,`test-${sdkKey}`);
    const policyDir=await mkdtemp(path.join(tmpdir(),"riic-gateway-test-"));
    const gateway=createServer(async(req,res)=>{
      if(req.url.startsWith("/v1/magpie/usage/requests")){res.setHeader("Content-Type","application/json");res.end(JSON.stringify({rows:gatewayRows,total:gatewayRows.length}));return;}
      if(req.url.startsWith("/v1/magpie/route")){res.setHeader("Content-Type","application/json");res.end(JSON.stringify({route}));return;}
      let raw="";for await(const c of req)raw+=c;const request=JSON.parse(raw);
      assert.equal(request.model,`${selection.provider}/${selection.model}`);assert.equal(request.max_tokens,2048);
      assert.equal(req.headers["x-magpie-response-model"],"member");
      step++;route={id:routeBase+step,time:new Date().toISOString(),model:`${selection.provider}/${returnedModel}`,tries:[{model:`${selection.provider}/${returnedModel}`,status:200,done:true}]};
      gatewayRows.push({t:route.time,route_id:route.id,session:sdkSession,provider:selection.provider,model:returnedModel,response_id:`sdk-${sdkKey}-${step}`,in:5,out:2,cache_read:3,cache_write:2,status:200,priced:false});
      res.writeHead(200,{"Content-Type":"text/event-stream","X-Magpie-Provider":selection.provider,"X-Magpie-Model":`${selection.provider}/${returnedModel}`});
      const chunk=c=>res.write(`data: ${JSON.stringify({id:`sdk-${sdkKey}-${step}`,model:`${selection.provider}/${returnedModel}`,created:1,object:"chat.completion.chunk",...c})}\n\n`);
      if(step===1)chunk({choices:[{index:0,delta:{tool_calls:[{index:0,id:"sdk-tool",type:"function",function:{name:"solve",arguments:'{"ok":true}'}}]},finish_reason:null}]});
      else for(const content of corruptAnswer ? ["[[sys", "tem]] internal"] : ["safe RIIC_FILTER_","BLOCK_TEST safe"])chunk({choices:[{index:0,delta:{content},finish_reason:null}]});
      chunk({choices:[{index:0,delta:{},finish_reason:step===1?"tool_calls":"stop"}],usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12,prompt_tokens_details:{cached_tokens:3,cache_write_tokens:2}}});res.end("data: [DONE]\n\n");
    });
    await new Promise(resolve=>gateway.listen(0,"127.0.0.1",resolve));
    process.env.AGENT_GATEWAY_URL=`http://127.0.0.1:${gateway.address().port}/v1`;process.env.AGENT_GATEWAY_KEY="test-only";
    try {
      const sdkRun=await begin(sdkKey);
      const runtime=createGatewayRun({runId:sdkRun,sessionId:sdkSession,requestId:sdkRun,userId,filterVersion:policies.filter.id,filter:compileFilterPolicy(policies.filter.policy),selection});
      const result=streamText({model:withAgentAnswerBoundary(runtime.model,runtime.deliver),maxRetries:0,maxOutputTokens:2048,messages:[{role:"user",content:"test tool then answer"}],stopWhen:stepCountIs(3),tools:{solve:tool({inputSchema:z.object({ok:z.boolean()}),execute:async(_,options)=>{const id=await accounting.beginToolCharge(sdkRun,options.toolCallId,"solve_schedule");await accounting.finishToolCharge(id,true);return {ok:true};}})},onFinish:()=>runtime.finalize("completed")});
      assert.equal(await result.text,"safe *** safe");
      await runtime.finalize("completed");
      const sdkDetail=await admin.billingRunDetail(sdkRun);assert.equal(sdkDetail.calls.length,2);assert.equal(sdkDetail.run.charged_points,1.0004);assert.ok(sdkDetail.calls.every(c=>c.status==="measured"&&c.input_tokens===10&&c.cached_input_tokens===3&&c.cache_write_tokens===2));
      assert.equal((await pool.query("SELECT cache_write_tokens FROM app.agent_usage WHERE id=$1",[sdkRun])).rows[0].cache_write_tokens,4);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM app.agent_filter_event WHERE request_id=$1",[sdkRun])).rows[0].n,1);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM app.agent_gateway_usage WHERE call_id=any($1::text[])",[sdkDetail.calls.map(c=>c.id)])).rows[0].n,2);
      process.env.AGENT_GATEWAY_POLICY_DIR=policyDir;
      const {maintainAgentGateway,gatewayUsageIdentity}=await import("../agent/gateway-maintenance.ts");
      assert.equal((await maintainAgentGateway()).imported,2);assert.equal((await maintainAgentGateway()).imported,0);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM app.agent_gateway_usage WHERE call_id=any($1::text[])",[sdkDetail.calls.map(c=>c.id)])).rows[0].n,4);
      assert.equal((await pool.query("SELECT status FROM app.agent_gateway_status WHERE id='gateway'")).rows[0].status,"healthy");
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM app.billing_review WHERE run_id=$1 AND kind='gateway_usage_mismatch'",[sdkRun])).rows[0].n,0);
      const importedId=gatewayUsageIdentity(gatewayRows[0]);
      const imported=(await pool.query("SELECT details FROM app.agent_gateway_usage WHERE id=$1",[importedId])).rows[0].details;
      assert.equal(imported.inputTokens,10);assert.equal(imported.cacheWriteTokens,2);
      // Upgrade old telemetry without rewriting the settled call's historical measurement or price.
      const historicalCall=sdkDetail.calls[0];
      await pool.query("UPDATE app.agent_model_call SET cache_write_tokens=NULL WHERE id=$1",[historicalCall.id]);
      await pool.query("UPDATE app.agent_usage SET cache_write_tokens=NULL WHERE id=$1",[sdkRun]);
      await pool.query("UPDATE app.agent_gateway_usage SET details=(details-'cacheWriteTokens') || '{\"inputTokens\":8}'::jsonb WHERE id=$1",[importedId]);
      assert.equal((await maintainAgentGateway()).imported,1);assert.equal((await maintainAgentGateway()).imported,0);
      const restored=(await pool.query("SELECT details FROM app.agent_gateway_usage WHERE id=$1",[importedId])).rows[0].details;
      assert.equal(restored.inputTokens,10);assert.equal(restored.cacheWriteTokens,2);
      const untouched=(await pool.query("SELECT cache_write_tokens,upstream_rmb,charged_rmb FROM app.agent_model_call WHERE id=$1",[historicalCall.id])).rows[0];
      assert.equal(untouched.cache_write_tokens,null);
      assert.equal(untouched.upstream_rmb,historicalCall.upstream_rmb);assert.equal(untouched.charged_rmb,historicalCall.charged_rmb);
      assert.equal((await pool.query("SELECT cache_write_tokens FROM app.agent_usage WHERE id=$1",[sdkRun])).rows[0].cache_write_tokens,null);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM app.billing_review WHERE run_id=$1 AND kind='gateway_usage_mismatch'",[sdkRun])).rows[0].n,0);
      corruptAnswer=true;
      const blockedRun=await begin();
      const blockedRuntime=createGatewayRun({runId:blockedRun,sessionId:sdkSession,requestId:blockedRun,userId,filterVersion:policies.filter.id,filter:compileFilterPolicy(policies.filter.policy),selection});
      const blockedResult=streamText({model:withAgentAnswerBoundary(blockedRuntime.model,blockedRuntime.deliver),maxRetries:0,maxOutputTokens:2048,prompt:"format guard",onError:()=>blockedRuntime.finalize("failed"),onFinish:()=>blockedRuntime.finalize("completed")});
      const blockedChunks=await Array.fromAsync(blockedResult.toUIMessageStream({onError:()=>"format error"}));
      await blockedRuntime.finalize("failed");
      assert.equal(blockedChunks.filter(part=>part.type==="text-delta").length,0);
      const blockedDetail=await admin.billingRunDetail(blockedRun);
      assert.equal(blockedDetail.run.charged_points,0);
      assert.equal(blockedDetail.calls[0].status,"measured");
      assert.equal((await getWallet(userId)).reservedPoints,0);

      // The gateway cannot silently replace the user's selection with an unknown model.
      corruptAnswer=false;returnedModel="unpriced-test-model";
      const unknownRun=await begin();
      const unknownRuntime=createGatewayRun({runId:unknownRun,sessionId:sdkSession,requestId:unknownRun,userId,filterVersion:policies.filter.id,filter:compileFilterPolicy(policies.filter.policy),selection});
      const unknownResult=streamText({model:withAgentAnswerBoundary(unknownRuntime.model,unknownRuntime.deliver),maxRetries:0,maxOutputTokens:2048,prompt:"unknown model",onError:()=>unknownRuntime.finalize("failed"),onFinish:()=>unknownRuntime.finalize("completed")});
      const unknownChunks=[];
      await assert.rejects(async()=>{
        for await(const chunk of unknownResult.toUIMessageStream({onError:()=>"model error"}))unknownChunks.push(chunk);
      },/本次回复中断/);
      await unknownRuntime.finalize("failed");
      assert.equal(unknownChunks.filter(part=>part.type==="text-delta").length,0);
      const unknownDetail=await admin.billingRunDetail(unknownRun);
      assert.equal(unknownDetail.calls[0].provider,null);
      assert.equal(unknownDetail.calls[0].model,null);
      for(const field of ["input_tokens","output_tokens","cached_input_tokens","cache_write_tokens","upstream_rmb","charged_rmb"]){
        assert.equal(unknownDetail.calls[0][field],null,`Unverified identity must not record ${field}`);
      }
      assert.equal(unknownDetail.calls[0].details.reason,"identity_failed");
      assert.equal(unknownDetail.run.charged_points,0);
      assert.equal(unknownDetail.run.settlement,"needs_review");
      assert.equal((await getWallet(userId)).reservedPoints,0);
    } finally { await new Promise(resolve=>gateway.close(resolve)); if(path.dirname(policyDir)===path.resolve(tmpdir())&&path.basename(policyDir).startsWith("riic-gateway-test-"))await rm(policyDir,{recursive:true,force:true}); }
    // The direct-provider rollback path must retain fractional fees and refund failed solvers.
    await pool.query("UPDATE app.billing_wallet SET paid_points=2,monthly_points=0.1234,monthly_expires_at=now()+interval '1 day' WHERE user_id=$1",[userId]);
    const direct = await createAgentUsage({userId,toolName:"agent_chat",idempotencyKey:randomUUID()});
    await Promise.all([1,2].map(()=>finalizeAgentUsage({usageId:direct,chargedPoints:0.0156,upstreamCostRmbFen:0.1302,chargedCostRmbFen:0.15624,inputTokens:1000,cachedInputTokens:100,cacheWriteTokens:200,outputTokens:100})));
    assert.equal((await getWallet(userId)).monthlyPoints,0.1078);
    assert.equal((await getWallet(userId)).paidPoints,2);
    const directUsage=(await listUsage(userId)).find(row=>row.id===direct);
    assert.equal(directUsage.points,0.0156);
    assert.equal(directUsage.chargedCostRmbFen,0.156);
    assert.equal(directUsage.cacheWriteTokens,200);
    for (const reason of ["missing_usage", "unknown_model"]) {
      const unconfirmed = await createAgentUsage({ userId, toolName: "agent_chat", idempotencyKey: randomUUID() });
      const beforeWallet = await getWallet(userId);
      if (reason === "unknown_model") assert.throws(() => calculateAgentTokenCost(policies.rates.policy, "riic-deepseek", "unknown-deepseek-model", { inputTokens: 100, outputTokens: 10 }));
      await finalizeAgentUsage({ usageId: unconfirmed, metadata: { rateVersion: policies.rates.id, usageIssue: reason } });
      const row = (await pool.query("SELECT * FROM app.agent_usage WHERE id=$1", [unconfirmed])).rows[0];
      assert.equal(row.status, "completed_unsettled");
      assert.equal(row.cache_write_tokens, null);
      assert.equal(row.metadata.settlement.usageConfirmed, false);
      assert.equal(row.metadata.settlement.tokenPoints, null);
      assert.equal((await listUsage(userId)).find(usage => usage.id === unconfirmed).tokenPoints, null);
      assert.equal(row.metadata.rateVersion, policies.rates.id);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM app.billing_ledger WHERE reference_id=$1 AND kind='token_settlement'", [unconfirmed])).rows[0].n, 0);
      assert.deepEqual(await getWallet(userId), beforeWallet);
    }
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

    // Synthetic explicitly configured GPT rates must not change legacy snapshots.
    await pool.query("UPDATE app.billing_wallet SET paid_points=20,monthly_points=0 WHERE user_id=$1",[userId]);
    const selectedRates=globalThis.structuredClone(policies.rates);
    selectedRates.policy.models.push({provider:"riic-gpt",model:"gpt-6.1-sol",currency:"RMB",exchangeRate:"1",input:"5",cachedInput:"1",output:"15"});
    const modelSelection={id:"gpt-6.1-sol",provider:"riic-gpt",model:"gpt-6.1-sol"};
    const selectedKey=randomUUID();
    const selectedRun=await accounting.beginAgentRun({userId,conversationId:`test-${selectedKey}`,idempotencyKey:selectedKey,requestHash:"selected-model-hash",rates:selectedRates,filterVersion:policies.filter.id,modelSelection});
    const budget={provider:"riic-gpt",model:"gpt-6.1-sol",inputTokens:2000,maxOutputTokens:1000};
    const selectedCall=await accounting.beginModelCall(selectedRun,0,budget);
    assert.equal((await getWallet(userId)).reservedPoints,0.3);
    assert.deepEqual((await pool.query("SELECT model_selection FROM app.agent_run WHERE id=$1",[selectedRun])).rows[0].model_selection,modelSelection);
    const selectedUsage={id:selectedCall.id,provider:budget.provider,model:budget.model,usage:{inputTokens:1000,cachedInputTokens:100,outputTokens:100,reasoningTokens:60,imageTokens:400}};
    await Promise.all([accounting.finishModelCall(selectedUsage),accounting.finishModelCall(selectedUsage)]);
    await accounting.settleAgentRun(selectedRun,"completed");
    const selectedDetail=await admin.billingRunDetail(selectedRun);
    assert.equal(selectedDetail.run.charged_points,0.0732);
    assert.deepEqual(selectedDetail.calls[0].details,{budget,reason:null,reasoningTokens:60,imageTokens:400});
    assert.equal((await getWallet(userId)).paidPoints,19.9268);
    assert.equal((await getWallet(userId)).reservedPoints,0);
    assert.equal((await pool.query("SELECT jsonb_array_length(policy->'models') AS models FROM app.agent_run WHERE id=$1",[run])).rows[0].models,policies.rates.policy.models.length);

    // Missing prices and a returned model outside the reservation fail closed.
    const unpriced=await begin();
    await assert.rejects(accounting.beginModelCall(unpriced,0,budget),/Unknown actual model rate/);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM app.agent_model_call WHERE run_id=$1",[unpriced])).rows[0].n,0);
    await accounting.settleAgentRun(unpriced,"failed");
    const mismatched=await begin();
    const mismatchedCall=await accounting.beginModelCall(mismatched,0,{provider:"riic-deepseek",model:"deepseek-v4.1-flash",inputTokens:1000,maxOutputTokens:100});
    await accounting.finishModelCall({id:mismatchedCall.id,provider:"riic-glm",model:"glm-5.3-flash",usage:{inputTokens:1000,cachedInputTokens:100,outputTokens:100}});
    await assert.rejects(accounting.beginModelCall(mismatched,1,0,100),error=>error.code==="usage_pending");
    await accounting.settleAgentRun(mismatched,"completed");
    const mismatchedDetail=await admin.billingRunDetail(mismatched);
    assert.equal(mismatchedDetail.calls[0].status,"unknown_model_or_usage");
    assert.equal(mismatchedDetail.run.settlement,"needs_review");
    assert.equal(mismatchedDetail.run.charged_points,0);
    assert.equal((await getWallet(userId)).paidPoints,19.9268);
    assert.equal((await getWallet(userId)).reservedPoints,0);

    // Invalid upstream counters must become an auditable missing measurement,
    // never a failed integer write or a fabricated zero-token bill.
    for (const badUsage of [
      {inputTokens:NaN,cachedInputTokens:0,outputTokens:1},
      {inputTokens:100,cachedInputTokens:0,outputTokens:Infinity},
      {inputTokens:100,cachedInputTokens:0,outputTokens:2_147_483_648},
      {inputTokens:100,cachedInputTokens:101,outputTokens:1},
      {inputTokens:100,cachedInputTokens:0,outputTokens:1,reasoningTokens:2},
      {inputTokens:100,cachedInputTokens:40,cacheWriteTokens:61,outputTokens:1},
      {inputTokens:100,cachedInputTokens:0,cacheWriteTokens:-1,outputTokens:1},
      {inputTokens:100,cachedInputTokens:0,cacheWriteTokens:Infinity,outputTokens:1},
    ]) {
      const invalidRun=await begin();const invalidCall=await accounting.beginModelCall(invalidRun,0,1000,100);
      await accounting.finishModelCall({id:invalidCall.id,provider:"riic-deepseek",model:"deepseek-v4.1-flash",usage:badUsage});
      await accounting.settleAgentRun(invalidRun,"completed");
      const invalidDetail=await admin.billingRunDetail(invalidRun);
      assert.equal(invalidDetail.calls[0].status,"unknown_model_or_usage");
      assert.equal(invalidDetail.calls[0].input_tokens,null);
      assert.equal(invalidDetail.calls[0].output_tokens,null);
      assert.equal(invalidDetail.calls[0].cached_input_tokens,null);
      assert.equal(invalidDetail.calls[0].cache_write_tokens,null);
      assert.equal(invalidDetail.calls[0].details.invalidUsage,true);
      assert.equal(invalidDetail.run.settlement,"needs_review");
      assert.equal(invalidDetail.run.charged_points,0);
      assert.equal((await getWallet(userId)).reservedPoints,0);
    }
    assert.equal((await getWallet(userId)).paidPoints,19.9268);

    // A verified request bound must stop subsequent calls when the supplier
    // reports more tokens; retain the actual evidence without charging estimates.
    for (const excessiveUsage of [
      {inputTokens:1001,cachedInputTokens:100,outputTokens:100},
      {inputTokens:1000,cachedInputTokens:100,outputTokens:101},
    ]) {
      const excessiveRun=await begin();
      const excessiveCall=await accounting.beginModelCall(excessiveRun,0,{provider:"riic-deepseek",model:"deepseek-v4.1-flash",inputTokens:1000,maxOutputTokens:100});
      await accounting.finishModelCall({id:excessiveCall.id,provider:"riic-deepseek",model:"deepseek-v4.1-flash",usage:excessiveUsage});
      await assert.rejects(accounting.beginModelCall(excessiveRun,1,1000,100),error=>error.code==="usage_pending");
      await accounting.settleAgentRun(excessiveRun,"completed");
      const excessiveDetail=await admin.billingRunDetail(excessiveRun);
      assert.equal(excessiveDetail.calls[0].status,"unknown_model_or_usage");
      assert.equal(excessiveDetail.calls[0].details.budgetExceeded,true);
      assert.equal(excessiveDetail.calls[0].input_tokens,excessiveUsage.inputTokens);
      assert.equal(excessiveDetail.calls[0].output_tokens,excessiveUsage.outputTokens);
      assert.equal(excessiveDetail.calls[0].charged_rmb,null);
      assert.equal(excessiveDetail.run.charged_points,0);
      assert.equal(excessiveDetail.run.settlement,"needs_review");
      assert.equal((await getWallet(userId)).reservedPoints,0);
    }

    // Legacy individually valid int32 counts can overflow the run's int32
    // summary. Preserve step evidence, release reservations and request review.
    const freeRates=globalThis.structuredClone(policies.rates);
    for(const rate of freeRates.policy.models) {rate.input="0";rate.cachedInput="0";rate.output="0";delete rate.peak;}
    const overflowKey=randomUUID();
    const overflowRun=await accounting.beginAgentRun({userId,conversationId:`test-${overflowKey}`,idempotencyKey:overflowKey,requestHash:"legacy-overflow",rates:freeRates,filterVersion:policies.filter.id});
    const legacyCount=1_073_741_824;
    for(let step=0;step<2;step++) {
      const overflowCall=await accounting.beginModelCall(overflowRun,step,0,100);
      await accounting.finishModelCall({id:overflowCall.id,provider:"riic-deepseek",model:"deepseek-v4.1-flash",usage:{inputTokens:legacyCount,cachedInputTokens:legacyCount,outputTokens:legacyCount}});
    }
    assert.ok((await getWallet(userId)).reservedPoints>0);
    await accounting.settleAgentRun(overflowRun,"completed");
    const overflowDetail=await admin.billingRunDetail(overflowRun);
    assert.equal(overflowDetail.calls.length,2);
    assert.ok(overflowDetail.calls.every(call=>call.status==="measured"&&call.input_tokens===legacyCount&&call.output_tokens===legacyCount&&call.cached_input_tokens===legacyCount));
    assert.equal(overflowDetail.run.settlement,"needs_review");
    assert.equal(overflowDetail.run.charged_points,0);
    const overflowSummary=(await pool.query("SELECT input_tokens,output_tokens,cached_input_tokens,metadata FROM app.agent_usage WHERE id=$1",[overflowRun])).rows[0];
    assert.equal(overflowSummary.input_tokens,null);assert.equal(overflowSummary.output_tokens,null);assert.equal(overflowSummary.cached_input_tokens,null);
    assert.deepEqual(overflowSummary.metadata.usageOverflowFields,["input_tokens","output_tokens","cached_input_tokens"]);
    assert.ok(overflowDetail.reviews.some(row=>row.kind==="settlement"));
    assert.equal((await getWallet(userId)).reservedPoints,0);
    assert.equal((await getWallet(userId)).paidPoints,19.9268);

    // A selected default group may settle any reserved fallback at its own rate.
    const routes = policies.rates.policy.models.map(({provider,model}) => ({provider,model}));
    const groupedBudget = {...routes[0],routes,inputTokens:1000,maxOutputTokens:100};
    for (const route of routes) {
      const balanceBefore = (await getWallet(userId)).paidPoints;
      const groupedRun = await begin();
      const groupedCall = await accounting.beginModelCall(groupedRun,0,groupedBudget);
      await accounting.finishModelCall({id:groupedCall.id,...route,usage:{inputTokens:500,cachedInputTokens:100,outputTokens:20}});
      await accounting.settleAgentRun(groupedRun,"completed");
      const groupedDetail = await admin.billingRunDetail(groupedRun);
      assert.equal(groupedDetail.calls[0].status,"measured");
      assert.equal(groupedDetail.calls[0].provider,route.provider);
      assert.deepEqual(groupedDetail.calls[0].details.budget.routes,routes);
      assert.ok(groupedDetail.run.charged_points > 0);
      assert.equal(Number((balanceBefore-groupedDetail.run.charged_points).toFixed(4)),(await getWallet(userId)).paidPoints);
      assert.equal((await getWallet(userId)).reservedPoints,0);
    }
    const balanceBefore = (await getWallet(userId)).paidPoints;
    const outsideGroup = await begin(); const outsideCall = await accounting.beginModelCall(outsideGroup,0,groupedBudget);
    await accounting.finishModelCall({id:outsideCall.id,provider:"riic-gpt",model:"gpt-6.1-sol",usage:{inputTokens:500,cachedInputTokens:100,outputTokens:20}});
    await accounting.settleAgentRun(outsideGroup,"completed");
    assert.equal((await admin.billingRunDetail(outsideGroup)).run.settlement,"needs_review");
    assert.equal((await getWallet(userId)).paidPoints,balanceBefore);
    assert.equal((await getWallet(userId)).reservedPoints,0);

    const writeRates=globalThis.structuredClone(selectedRates);
    Object.assign(writeRates.policy.models[3],{input:"1",cachedInput:"0.1",cacheWrite:"1.25",output:"2"});
    const writeBudget={...budget,inputTokens:20000,maxOutputTokens:100};
    const beginWrite=async(rates=writeRates)=>{const key=randomUUID();return accounting.beginAgentRun({userId,conversationId:`test-${key}`,idempotencyKey:key,requestHash:"cache-write",rates,filterVersion:policies.filter.id,modelSelection});};
    const writeRun=await beginWrite();
    for(const [step,usage] of [{inputTokens:12000,cachedInputTokens:0,cacheWriteTokens:12000,outputTokens:0},
      {inputTokens:15000,cachedInputTokens:12000,cacheWriteTokens:3000,outputTokens:0}].entries()) {
      const call=await accounting.beginModelCall(writeRun,step,writeBudget);
      if(step===0)assert.equal((await getWallet(userId)).reservedPoints,0.3024,"reservation covers all input becoming a cache write");
      await accounting.finishModelCall({id:call.id,provider:budget.provider,model:budget.model,usage});
    }
    await accounting.settleAgentRun(writeRun,"completed");
    const writeDetail=await admin.billingRunDetail(writeRun);
    assert.deepEqual(writeDetail.calls.map(call=>call.cache_write_tokens),[12000,3000]);
    assert.deepEqual(writeDetail.calls.map(call=>Number(call.upstream_rmb)),[0.015,0.00495]);
    assert.equal(writeDetail.run.charged_points,0.2394);assert.equal(writeDetail.run.settlement,"settled");
    const writeSummary=(await pool.query("SELECT input_tokens,cached_input_tokens,cache_write_tokens,output_tokens,status FROM app.agent_usage WHERE id=$1",[writeRun])).rows[0];
    assert.deepEqual(writeSummary,{input_tokens:27000,cached_input_tokens:12000,cache_write_tokens:15000,output_tokens:0,status:"completed"});
    assert.equal((await getWallet(userId)).reservedPoints,0);

    const missingRun=await beginWrite();const missingCall=await accounting.beginModelCall(missingRun,0,writeBudget);
    await accounting.finishModelCall({id:missingCall.id,provider:budget.provider,model:budget.model,usage:{inputTokens:1000,cachedInputTokens:200,outputTokens:10}});
    await assert.rejects(accounting.beginModelCall(missingRun,1,writeBudget),error=>error.code==="usage_pending");
    await accounting.settleAgentRun(missingRun,"completed");
    const missingDetail=await admin.billingRunDetail(missingRun);
    assert.equal(missingDetail.calls[0].status,"unknown_model_or_usage");assert.equal(missingDetail.calls[0].cache_write_tokens,null);
    assert.equal(missingDetail.calls[0].input_tokens,1000);assert.equal(missingDetail.calls[0].cached_input_tokens,200);
    assert.equal(missingDetail.calls[0].details.reason,"cache_write_usage_missing");assert.equal(missingDetail.calls[0].details.missingCacheWriteUsage,true);
    assert.equal(missingDetail.calls[0].charged_rmb,null);assert.equal(missingDetail.run.charged_points,0);assert.equal(missingDetail.run.settlement,"needs_review");
    assert.equal((await getWallet(userId)).reservedPoints,0);

    const zeroRun=await beginWrite();const zeroCall=await accounting.beginModelCall(zeroRun,0,writeBudget);
    await accounting.finishModelCall({id:zeroCall.id,provider:budget.provider,model:budget.model,usage:{inputTokens:1000,cachedInputTokens:200,cacheWriteTokens:0,outputTokens:10}});
    await accounting.settleAgentRun(zeroRun,"completed");
    assert.equal((await admin.billingRunDetail(zeroRun)).run.settlement,"settled");
    assert.equal((await pool.query("SELECT cache_write_tokens FROM app.agent_usage WHERE id=$1",[zeroRun])).rows[0].cache_write_tokens,0);

    const oldRates=globalThis.structuredClone(writeRates);delete oldRates.policy.models[3].cacheWrite;
    const oldRun=await beginWrite(oldRates);
    for(const [step,usage] of [{inputTokens:12000,cachedInputTokens:0,cacheWriteTokens:12000,outputTokens:0},
      {inputTokens:15000,cachedInputTokens:12000,outputTokens:0}].entries()) {
      const call=await accounting.beginModelCall(oldRun,step,writeBudget);
      await accounting.finishModelCall({id:call.id,provider:budget.provider,model:budget.model,usage});
    }
    await accounting.settleAgentRun(oldRun,"completed");
    const oldDetail=await admin.billingRunDetail(oldRun);
    assert.equal(oldDetail.run.charged_points,0.1944);assert.equal(oldDetail.run.settlement,"settled");
    assert.deepEqual(oldDetail.calls.map(call=>call.cache_write_tokens),[12000,null]);
    const oldSummary=(await pool.query("SELECT input_tokens,cached_input_tokens,cache_write_tokens,output_tokens,status FROM app.agent_usage WHERE id=$1",[oldRun])).rows[0];
    assert.deepEqual(oldSummary,{input_tokens:27000,cached_input_tokens:12000,cache_write_tokens:null,output_tokens:0,status:"completed"});
    assert.equal((await getWallet(userId)).reservedPoints,0);
    // The new per-image reservation admits a small wallet and releases unused holds.
    const { modelCallBudget } = await import("../agent/model-budget.ts");
    const imageSelection = { ...defaultModelPolicy().models[2], id: "gpt", enabled: true,
      provider: "riic-gpt", model: "gpt-6.1-sol", vision: true, protocol: "responses", policyVersion: "test-image-models" };
    const imageBudget = modelCallBudget(imageSelection, { prompt: [{ role: "user", content: [
      { type: "text", text: "read this" }, { type: "file", mediaType: "image/png", data: { type: "data", data: new Uint8Array(1) } },
    ] }], maxOutputTokens: 2048 });
    assert.ok(imageBudget.inputTokens < 18000);
    await pool.query("UPDATE app.billing_wallet SET paid_points=2,monthly_points=0 WHERE user_id=$1", [userId]);
    const imageKey = randomUUID();
    const imageRun = await accounting.beginAgentRun({ userId, conversationId: imageKey, idempotencyKey: imageKey, requestHash: "image-reservation", rates: selectedRates, filterVersion: policies.filter.id, modelSelection: imageSelection });
    const imageCall = await accounting.beginModelCall(imageRun, 0, imageBudget);
    assert.ok((await getWallet(userId)).reservedPoints > 0 && (await getWallet(userId)).reservedPoints < 2);
    await accounting.finishModelCall({ id: imageCall.id, provider: "riic-gpt", model: "gpt-6.1-sol", usage: { inputTokens: 6854, cachedInputTokens: 0, outputTokens: 290 } });
    await accounting.settleAgentRun(imageRun, "completed");
    const imageDetail = await admin.billingRunDetail(imageRun);
    assert.equal(imageDetail.run.settlement, "settled");
    assert.equal(imageDetail.run.charged_points, 0.4634); // 0.46344 rounds to four decimal places.
    assert.equal((await getWallet(userId)).reservedPoints, 0);
    assert.deepEqual(imageDetail.calls[0].details.budget, imageBudget);

    // Large text estimates are admitted and settled with the configured long tier.
    await pool.query("UPDATE app.billing_wallet SET paid_points=100,monthly_points=0 WHERE user_id=$1", [userId]);
    const longRates = globalThis.structuredClone(selectedRates);
    longRates.policy.models.find(row => row.provider === "riic-gpt").longContext = { inputTokenThreshold: 272000, input: "10", cachedInput: "2", output: "22.5" };
    const longKey = randomUUID();
    const longRun = await accounting.beginAgentRun({ userId, conversationId: longKey, idempotencyKey: longKey, requestHash: "long-reservation", rates: longRates, filterVersion: policies.filter.id, modelSelection: imageSelection });
    const longBudget = { ...imageBudget, inputTokens: 300000 };
    const longCall = await accounting.beginModelCall(longRun, 0, longBudget);
    assert.ok((await getWallet(userId)).reservedPoints > 36);
    await accounting.finishModelCall({ id: longCall.id, provider: "riic-gpt", model: "gpt-6.1-sol", usage: { inputTokens: 273000, cachedInputTokens: 0, outputTokens: 100 } });
    await accounting.settleAgentRun(longRun, "completed");
    const longDetail = await admin.billingRunDetail(longRun);
    assert.equal(longDetail.run.settlement, "settled");
    assert.equal(longDetail.run.charged_points, 32.787);
    assert.equal((await getWallet(userId)).reservedPoints, 0);
  } finally {
    await pool.query('DELETE FROM public."user" WHERE id=any($1::text[])',[[userId,actor]]);
    await pool.end();
    process.env = originalEnv;
  }
});
