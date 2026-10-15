import assert from "node:assert/strict";
import console from "node:console";
import { createHash } from "node:crypto";
import { mkdir,mkdtemp,readFile,rm } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
register("../../scripts/ts-path-loader.mjs",import.meta.url);

test("runPlan keeps both attempts, validates fallback output, and leaves input rejection outside fallback",async context=>{
  const root=await mkdtemp(path.join(tmpdir(),"riic-fallback-integration-"));
  const executableHash=createHash("sha256").update(await readFile(process.execPath)).digest("hex");
  await mkdir(path.join(root,"data"));
  const variables={BETA_STORAGE_DIR:root,BETA_BUSINESS_DB_ENABLED:"0",INFRA_CLI_PATH:process.execPath,
    INFRA_CLI_EXPECTED_SHA256:"b".repeat(64),INFRA_FALLBACK_CLI_PATH:process.execPath,
    INFRA_FALLBACK_DATA_DIR:path.join(root,"data"),INFRA_FALLBACK_CLI_SHA256:executableHash,
    INFRA_FALLBACK_DATA_SHA256:createHash("sha256").digest("hex")};
  const previous=Object.fromEntries(Object.keys(variables).map(key=>[key,process.env[key]]));
  Object.assign(process.env,variables);
  context.after(async()=>{
    for(const [key,value] of Object.entries(previous)) {if(value===undefined)delete process.env[key];else process.env[key]=value;}
    await rm(root,{recursive:true,force:true});
  });
  context.mock.method(console,"info",()=>{});context.mock.method(console,"error",()=>{});
  const {InfraCliServeClient}=await import("./serve-client.ts");
  let primaryFails=true;let fallbackFails=false;let malformedFallback=false;let incompleteMaa=false;let oldProfile=false;
  const calls=[];
  const valid=()=>({schema_version:3,
    profile:{schema_version:4,domains:[{label:"test"}],summary:{owned:1},rotation:{},baseline_rotation:{},actions:[],flags:[],narration_hints:[]},
    rotation:{profile:"abc_12_6_6",daily:{},shifts:[{},{},{}]},
    maa:{title:"fixture",description:"fixture",planTimes:3,plans:[1,2,3].map(index=>({name:`Shift ${index}`,rooms:{control:[{operators:["Amiya"]}]}}))},
    training_advice:{schema_version:2,context:{},newbie_section_status:"complete",incomplete_newbie:[],combinations:[],recommendations:[]}});
  context.mock.method(InfraCliServeClient.prototype,"send",async function(method,params){
    const engine=this.options.cwd ? "fallback" : "primary";
    const request={id:calls.length+1,method,params};
    let response;
    if(method==="ping") response={ok:true,result:{pong:true,protocol_version:1,plan_schema_version:1,
      supported_plan_schema_versions:[1,2,3],solver_executable_sha256:engine==="fallback" ? executableHash : "b".repeat(64)}};
    else {
      calls.push({engine,params:JSON.parse(JSON.stringify(params))});
      const fails=engine==="primary" ? primaryFails : fallbackFails;
      response=fails ? {ok:false,elapsed_ms:3,error:{message:`${engine} capacity failure`}}
        : {ok:true,elapsed_ms:5,result:valid()};
      if(engine==="fallback" && malformedFallback) response.result={...valid(),error:{message:"partial result failure"}};
      if(engine==="fallback" && incompleteMaa) response.result.maa.plans=[];
      if(engine==="fallback" && oldProfile) response.result.profile.schema_version=3;
    }
    return {request,response,stdout:JSON.stringify(response),stderr:""};
  });
  const {runPlan,stopInfraServeClients}=await import("./infra.ts");
  context.after(()=>stopInfraServeClients("test complete"));
  const body=()=>({layout:{template:"243",rooms:[],scenario:{}},operbox:[{id:"char_001_amiya",name:"阿米娅",elite:2,level:80,rarity:5,potential:1,own:true}],rotation:"abc_12_6_6",fiammettaEnable:false});
  const recovered=await runPlan(body(),{deferArtifacts:true});
  assert.equal(recovered.success,true);assert.equal(recovered.fallbackUsed,true);
  assert.equal(recovered.solver.solver_executable_sha256,executableHash);
  assert.equal(recovered.solverDurationMs,8);
  assert.deepEqual(calls.map(call=>call.engine),["primary","fallback"]);
  assert.deepEqual(calls[0].params,calls[1].params);
  assert.equal(calls[1].params.options.fiammetta_enable,false);
  const first=JSON.parse(await readFile(path.join(recovered.runPath,"primary-attempt.json"),"utf8"));
  const second=JSON.parse(await readFile(path.join(recovered.runPath,"fallback-attempt.json"),"utf8"));
  assert.equal(first.response.ok,false);assert.equal(second.response.ok,true);
  assert.match(await readFile(path.join(root,"diagnostic-logs",`${new Date().toISOString().slice(0,10)}.ndjson`),"utf8"),/recovered/);

  calls.length=0;primaryFails=false;
  const healthy=await runPlan(body());assert.equal(healthy.success,true);assert.equal(healthy.fallbackUsed,false);
  assert.deepEqual(calls.map(call=>call.engine),["primary"]);

  calls.length=0;primaryFails=true;fallbackFails=true;
  const failed=await runPlan(body());assert.equal(failed.success,false);assert.equal(failed.fallbackUsed,true);
  assert.match(failed.error,/primary capacity failure/);assert.match(failed.error,/fallback capacity failure/);
  assert.equal(calls.length,2);

  calls.length=0;fallbackFails=false;malformedFallback=true;
  const partial=await runPlan(body());assert.equal(partial.success,false);assert.equal(calls.length,2);
  assert.equal(partial.solverAttempts[1].status,"failed");
  assert.match(partial.error,/partial result failure/);

  calls.length=0;malformedFallback=false;incompleteMaa=true;
  const emptyMaa=await runPlan(body());assert.equal(emptyMaa.success,false);
  assert.equal(emptyMaa.solverAttempts[1].status,"failed");assert.match(emptyMaa.error,/incomplete MAA/);

  calls.length=0;incompleteMaa=false;oldProfile=true;
  const oldSchema=await runPlan(body());assert.equal(oldSchema.success,false);
  assert.equal(oldSchema.solverAttempts[1].status,"failed");assert.match(oldSchema.error,/incomplete account profile/);

  calls.length=0;primaryFails=false;
  for(const key of Object.keys(variables).filter(key=>key.startsWith("INFRA_FALLBACK_"))) delete process.env[key];
  const disabled=await runPlan(body());assert.equal(disabled.success,true);
  assert.deepEqual(calls.map(call=>call.engine),["primary"]);

  calls.length=0;const invalid=body();invalid.operbox[0].own=false;
  await assert.rejects(runPlan(invalid),error=>error.code==="AIC-BOX-1101");assert.equal(calls.length,0);
});
