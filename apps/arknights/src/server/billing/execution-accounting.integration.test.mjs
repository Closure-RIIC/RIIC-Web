import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { register, registerHooks } from "node:module";
import test from "node:test";
import process from "node:process";
import { URL } from "node:url";
import { ReadableStream } from "node:stream/web";
register("../../../../../scripts/ts-path-loader.mjs", import.meta.url);
registerHooks({ resolve(specifier, context, next) { return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context); } });
const url = process.env.AUTH_INTEGRATION_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test")) throw new Error("Isolated *_test database required");
process.env.DATABASE_URL = url;
const { getDatabasePool } = await import("@riic/platform-server/db");
const accounting = await import("./agent-accounting.ts");
const { chargeAgentTool, getWallet } = await import("./service.ts");
const { createToolExecutor, readToolExecution } = await import("../agent/tool-executor.ts");
const { waitForTool } = await import("../agent/execution-types.ts");
const { createAccountedRun } = await import("../agent/accounted-runtime.ts");
const { compileFilterPolicy } = await import("../agent/filter-policy.ts");
const { streamText } = await import("ai");
const { MockLanguageModelV4 } = await import("ai/test");

test("execution evidence, model fees and settlement are independent", async t => {
  const pool = getDatabasePool();
  const userId = `execution-test-${randomUUID()}`;
  try {
    await pool.query('INSERT INTO public."user" (id,name,email) VALUES ($1,$1,$2)', [userId, `${userId}@example.test`]);
    await pool.query("INSERT INTO app.billing_wallet (user_id,paid_points) VALUES ($1,100)", [userId]);
    const policies = await accounting.activeAgentPolicies();
    const begin = () => accounting.beginAgentRun({userId,conversationId:randomUUID(),idempotencyKey:randomUUID(),requestHash:"test",rates:policies.rates,filterVersion:policies.filter.id});
    const detail = async id => (await pool.query("SELECT * FROM app.agent_run WHERE id=$1",[id])).rows[0];
    const verified = async id => {
      const call = await accounting.beginModelCall(id, 0, 1000, 100);
      await accounting.finishModelCall({id:call.id,provider:"riic-deepseek",model:"deepseek-v4.1-flash",usage:{inputTokens:1000,outputTokens:100,cachedInputTokens:100}});
    };
    await t.test("the same verified usage is charged for every conversation outcome without delivery", async () => {
      const points=[];
      for (const state of ["completed","failed","cancelled","blocked"]) {
        const id=await begin();await verified(id);
        await Promise.all([accounting.settleAgentRun(id,state),accounting.settleAgentRun(id,state)]);
        const run=await detail(id);points.push(Number(run.charged_points));
        assert.equal(run.state,state);assert.equal(run.settlement,"settled");assert.equal(run.delivered,false);
        const usage=(await pool.query("SELECT metadata FROM app.agent_usage WHERE id=$1",[id])).rows[0];
        assert.equal(usage.metadata.conversationState,state);assert.equal(usage.metadata.settlementState,"settled");
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM app.billing_ledger WHERE reference_id=$1",[id])).rows[0].n,1);
      }
      assert.ok(points[0]>0);assert.ok(points.every(value=>value===points[0]));
    });
    await t.test("settlement closes abandoned fee reservations and rejects late fees", async () => {
      const id=await begin();const charge=await accounting.beginToolCharge(id,"abandoned","solve_schedule");
      await accounting.settleAgentRun(id,"cancelled");
      await accounting.finishToolCharge(charge,true);
      assert.equal(Number((await detail(id)).charged_points),0);
      assert.equal((await pool.query("SELECT status FROM app.agent_tool_charge WHERE id=$1",[charge])).rows[0].status,"failed");
      const racing=await begin();const racingCharge=await accounting.beginToolCharge(racing,"race","solve_schedule");
      await Promise.all([accounting.finishToolCharge(racingCharge,true),accounting.settleAgentRun(racing,"failed")]);
      const row=await detail(racing);
      assert.equal(Number(row.tool_points),Number(row.charged_points));
      assert.equal(row.delivered,false);
    });
    await t.test("wait timeout followed by success retains the result, but never charges a late tool fee", async () => {
      const id=await begin();const executor=createToolExecutor(id,async()=>{});
      let finish;const gate=new Promise(resolve=>{finish=resolve;});let late;
      const result={diagnosticId:"test",durationMs:1,profile:{layout_label:"243",operbox_label:"sample",summary:{},rotation:{}},maa:{plans:[]}};
      const tools=executor.wrap({solve_schedule:{execute:async(_,options)=>{
        await executor.recordSolve(options.toolCallId,{computation:"running"});
        late=gate.then(async()=>{
          await executor.recordSolve(options.toolCallId,{computation:"succeeded"});
          await executor.recordSolve(options.toolCallId,{processing:"succeeded",result});
        });
        try { await waitForTool(late,5);return {solved:true}; }
        catch(error){return {error:error.message,errorCode:error.code};}
      }}});
      const output=await tools.solve_schedule.execute({}, {toolCallId:"late",messages:[]});
      assert.equal(output.execution.state,"timed_out");
      await verified(id);await accounting.settleAgentRun(id,"failed");
      const charged=Number((await detail(id)).charged_points);
      finish();await late;
      const execution=await readToolExecution(output.execution.id,userId);
      assert.equal(execution.state,"timed_out");assert.equal(execution.computation_state,"succeeded");
      assert.equal(execution.processing_state,"succeeded");assert.equal(execution.plan.layoutLabel,"243");
      assert.equal(await readToolExecution(output.execution.id,"different-user"),null);
      assert.equal(Number((await detail(id)).charged_points),charged);
      assert.equal(Number((await detail(id)).tool_points),0);
      await assert.rejects(tools.solve_schedule.execute({}, {toolCallId:"late",messages:[]}));
    });
    await t.test("conversion failure preserves successful computation and releases the tool fee", async () => {
      const id=await begin();const executor=createToolExecutor(id,async()=>{});
      const tools=executor.wrap({solve_schedule:{execute:async(_,options)=>{
        await executor.recordSolve(options.toolCallId,{computation:"succeeded"});
        await executor.recordSolve(options.toolCallId,{processing:"failed",errorCode:"result_conversion_failed"});
        return {error:"conversion failed",errorCode:"result_conversion_failed"};
      }}});
      const output=await tools.solve_schedule.execute({}, {toolCallId:"convert",messages:[]});
      await accounting.settleAgentRun(id,"completed");
      const execution=await readToolExecution(output.execution.id,userId);
      assert.equal(execution.state,"failed");assert.equal(execution.computation_state,"succeeded");
      assert.equal(execution.processing_state,"failed");assert.equal(Number((await detail(id)).charged_points),0);
    });
    await t.test("direct adapter uses the same accounting middleware and records missing usage for review", async () => {
      for(const measured of [true,false]) {
        const id=await begin();
        const parts=[{type:"stream-start",warnings:[]}, {type:"response-metadata",id:"direct-test",modelId:"deepseek-v4.1-flash"}];
        if(measured)parts.push({type:"finish",finishReason:{unified:"stop",raw:"stop"},usage:{inputTokens:{total:1000,noCache:900,cacheRead:100,cacheWrite:0},outputTokens:{total:100,text:100,reasoning:0}}});
        const runtime=createAccountedRun({runId:id,requestId:id,userId,filterVersion:policies.filter.id,filter:compileFilterPolicy(policies.filter.policy),responseModelIdentity:true,
          identity:()=>({provider:"riic-deepseek",model:"alias"}),model:new MockLanguageModelV4({doStream:async()=>({stream:new ReadableStream({start(controller){for(const part of parts)controller.enqueue(part);controller.close();}})})})});
        const result=streamText({model:runtime.model,prompt:"test",maxRetries:0,maxOutputTokens:100,onError(){}});
        await Array.fromAsync(result.fullStream);
        await Promise.all([runtime.finalize("failed"),runtime.finalize("failed")]);
        const run=await detail(id);
        assert.equal(run.state,"failed");assert.equal(run.settlement,measured?"settled":"needs_review");
        assert.equal(Number(run.charged_points)>0,measured);
        const call=(await pool.query("SELECT * FROM app.agent_model_call WHERE run_id=$1",[id])).rows[0];
        assert.equal(call.status,measured?"measured":"missing");
        assert.equal(call.input_tokens,measured?1000:null);
      }
    });
    await t.test("interrupted historical direct usage closes for review without inventing a refund", async()=>{
      const charged=await chargeAgentTool({userId,toolName:"solve_schedule",points:1,idempotencyKey:randomUUID()});
      const balance=(await getWallet(userId)).totalPoints;
      await pool.query("UPDATE app.agent_usage SET created_at=now()-interval '20 minutes' WHERE id=$1",[charged.usageId]);
      await Promise.all([accounting.recoverAgentRuns(),accounting.recoverAgentRuns()]);
      const usage=(await pool.query("SELECT * FROM app.agent_usage WHERE id=$1",[charged.usageId])).rows[0];
      assert.equal(usage.status,"completed_unsettled");assert.equal(usage.metadata.conversationState,"unknown");
      assert.equal((await getWallet(userId)).totalPoints,balance);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM app.billing_review WHERE id=$1",[`usage:${charged.usageId}`])).rows[0].n,1);
    });
    await t.test("process recovery preserves uncertainty and releases unfinished tool reservations", async()=>{
      const id=await begin();const charge=await accounting.beginToolCharge(id,"orphan","solve_schedule");
      await pool.query("INSERT INTO app.agent_tool_execution(id,run_id,tool_call_id,name,state,computation_state) VALUES ($1,$2,'orphan','solve_schedule','running','running')",[randomUUID(),id]);
      await pool.query("UPDATE app.agent_run SET created_at=now()-interval '20 minutes' WHERE id=$1",[id]);
      await accounting.recoverAgentRuns();
      const execution=(await pool.query("SELECT * FROM app.agent_tool_execution WHERE run_id=$1",[id])).rows[0];
      assert.equal(execution.state,"unknown");assert.equal(execution.computation_state,"unknown");
      assert.equal((await pool.query("SELECT status FROM app.agent_tool_charge WHERE id=$1",[charge])).rows[0].status,"failed");
      assert.equal(Number((await detail(id)).held_paid),0);
    });
  } finally {
    await pool.query('DELETE FROM public."user" WHERE id=$1',[userId]);
    await pool.end();
  }
});
