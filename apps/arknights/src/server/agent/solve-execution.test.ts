import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import test from "node:test";
register("../../../../../scripts/ts-path-loader.mjs", import.meta.url);
registerHooks({ resolve(specifier, context, next) { return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context); } });

test("real solve tool separates solver failure, conversion failure and cancelled waiting with late success", async t => {
  let solve: () => Promise<unknown> = async () => ({ success: false });
  let convert = () => ({ diagnosticId: "test", durationMs: 1, profile: {layout_label:"243",operbox_label:"sample",summary:{},rotation:{}}, maa: {plans:[]} });
  await t.mock.module(new URL("../../../../../packages/arknights-domain/src/blueprint.ts",import.meta.url),{namedExports:{
    PRESETS:[{label:"243"}],buildBlueprint:()=>({rooms:[]}),factoryRecipeFor:()=>"gold",tradeOrderFor:()=>"gold",
    updateFactoryRecipe:(layout:unknown)=>layout,updateRoomLevel:(layout:unknown)=>layout,updateTradeOrder:(layout:unknown)=>layout,
  }});
  await t.mock.module(new URL("../../../../../packages/platform-server/src/infra.ts",import.meta.url),{namedExports:{runPlan:()=>solve(),getSampleOperbox:async()=>({operbox:[],sourceName:"sample"})}});
  await t.mock.module(new URL("../../../../../packages/platform-server/src/public-plan.ts",import.meta.url),{namedExports:{toPublicPlanData:()=>convert()}});
  await t.mock.module(new URL("../../../../../packages/platform-server/src/workspace.ts",import.meta.url),{namedExports:{getMaaOperboxSnapshot:async()=>null,listSavedPlans:async()=>({plans:[]})}});
  await t.mock.module(new URL("../../../../../packages/platform-server/src/skland/adapter.ts",import.meta.url),{namedExports:{loadStatusSnapshot:async()=>{throw new Error("not bound");},loadInventorySnapshot:async()=>{throw new Error("not bound");}}});
  await t.mock.module(new URL("../../../../../packages/platform-server/src/skland/http.ts",import.meta.url),{namedExports:{readSklandAccountStore:async()=>({accounts:[]}),activeSklandAccount:()=>null}});
  await t.mock.module(new URL("./calculator-tools.ts",import.meta.url),{namedExports:{buildCalculatorTools:()=>({})}});
  await t.mock.module(new URL("./health-tools.ts",import.meta.url),{namedExports:{buildHealthTools:()=>({})}});
  const { buildAgentTools } = await import("./tools.ts");
  const call = async (signal?: AbortSignal) => {
    const events: unknown[]=[];
    const tools=buildAgentTools({request:new Request("https://riic.test",{signal}),userId:"test",onSolveEvent:async(_,event)=>{events.push(event);}});
    const output=await tools.solve_schedule.execute!({boxSource:"sample"},{toolCallId:"test-call",messages:[],context:{},abortSignal:signal});
    return {events,output};
  };
  const failed=await call();
  assert.equal((failed.output as {errorCode:string}).errorCode,"solver_failed");
  assert.deepEqual(failed.events,[{computation:"running"},{computation:"failed",errorCode:"solver_failed"}]);
  solve=async()=>({success:true});
  const successfulConvert=convert;
  convert=()=>{throw new Error("bad result");};
  const conversion=await call();
  assert.equal((conversion.output as {errorCode:string}).errorCode,"result_conversion_failed");
  assert.deepEqual(conversion.events,[{computation:"running"},{computation:"succeeded"},{processing:"failed",errorCode:"result_conversion_failed"}]);
  convert=successfulConvert;
  const controller=new AbortController();
  let finish!: (value: unknown) => void;
  let solverCalls=0;
  solve=()=>{solverCalls++;return new Promise(resolve=>{finish=resolve;controller.abort();});};
  const cancelled=await call(controller.signal);
  assert.equal((cancelled.output as {errorCode:string}).errorCode,"tool_wait_cancelled");
  assert.deepEqual(cancelled.events,[{computation:"running"}]);
  finish({success:true});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(solverCalls,1);
  assert.deepEqual(cancelled.events.slice(0,2),[{computation:"running"},{computation:"succeeded"}]);
  assert.equal((cancelled.events[2] as unknown as {processing:string}).processing,"succeeded");
});
