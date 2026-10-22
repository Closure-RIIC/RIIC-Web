import assert from "node:assert/strict";
import path from "node:path";
import { mkdirSync,mkdtempSync,rmSync,symlinkSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import { hashSolverDataDirectory,readSolverFallbackConfig,runWithSolverFallback,SolverFallbackFailure,verifySolverFallbackConfig,withinSolverDeadline,withSolverLane } from "./solver-fallback.ts";

test("fallback configuration is disabled by default and requires all pinned fields",()=>{
  assert.equal(readSolverFallbackConfig({}),null);
  assert.throws(()=>readSolverFallbackConfig({INFRA_FALLBACK_CLI_PATH:path.resolve("solver")}));
  assert.throws(()=>readSolverFallbackConfig({INFRA_FALLBACK_CLI_PATH:"relative",INFRA_FALLBACK_DATA_DIR:path.resolve("data"),INFRA_FALLBACK_CLI_SHA256:"a".repeat(64)}));
  assert.equal(readSolverFallbackConfig({INFRA_FALLBACK_CLI_PATH:path.resolve("solver"),INFRA_FALLBACK_DATA_DIR:path.resolve("data"),INFRA_FALLBACK_CLI_SHA256:"a".repeat(64),INFRA_FALLBACK_DATA_SHA256:"b".repeat(64)})?.sha256,"a".repeat(64));
});

test("data snapshot drift is rejected independently of the executable pin",context=>{
  const root=mkdtempSync(path.join(tmpdir(),"riic-data-pin-"));
  const previous={...process.env};
  context.after(()=>{for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);rmSync(root,{recursive:true,force:true});});
  writeFileSync(path.join(root,"mechanics.json"),"original");
  Object.assign(process.env,{INFRA_FALLBACK_CLI_PATH:process.execPath,INFRA_FALLBACK_CLI_SHA256:"a".repeat(64),
    INFRA_FALLBACK_DATA_DIR:root,INFRA_FALLBACK_DATA_SHA256:hashSolverDataDirectory(root)});
  writeFileSync(path.join(root,"mechanics.json"),"changed");
  assert.throws(()=>verifySolverFallbackConfig(),/data SHA-256 mismatch/);
});

test("a linked data root is rejected even when its target contents match",context=>{
  const root=mkdtempSync(path.join(tmpdir(),"riic-data-link-"));
  context.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(path.join(root,"data"));
  symlinkSync(path.join(root,"data"),path.join(root,"link"),"junction");
  assert.throws(()=>hashSolverDataDirectory(path.join(root,"link")),/not a symlink/);
});

test("primary success never invokes fallback",async()=>{
  let calls=0;
  const result=await runWithSolverFallback({primary:async()=>"primary",fallback:async()=>{calls++;return "fallback";},budgetMs:100});
  assert.deepEqual(result,{value:"primary",fallbackUsed:false});assert.equal(calls,0);
});

test("one fallback uses only the remaining total budget and preserves the primary failure",async()=>{
  let now=0;let captured:unknown;let fallbackCalls=0;
  const original=new Error("capacity");
  const result=await runWithSolverFallback({budgetMs:100,now:()=>now,
    primary:async budget=>{assert.equal(budget,75);now=40;throw original;},
    onPrimaryFailure:async error=>{captured=error;now+=5;},
    fallback:async budget=>{fallbackCalls++;assert.equal(budget,55);return "valid v2";}});
  assert.equal(captured,original);assert.equal(fallbackCalls,1);assert.deepEqual(result,{value:"valid v2",fallbackUsed:true});
});

test("double failure retains both reasons and does not recurse",async()=>{
  let calls=0;
  await assert.rejects(runWithSolverFallback({budgetMs:100,
    primary:async()=>{throw new Error("primary invalid");},fallback:async()=>{calls++;throw new Error("v2 invalid");}}),
    error=>error instanceof SolverFallbackFailure && /primary invalid/.test(error.message) && /v2 invalid/.test(error.message));
  assert.equal(calls,1);
});

test("exhausted budget does not start another process",async()=>{
  let now=0;let calls=0;
  await assert.rejects(runWithSolverFallback({budgetMs:10,now:()=>now,primary:async()=>{now=11;throw new Error("timeout");},fallback:async()=>{calls++;return "bad";}}),/budget exhausted/);
  assert.equal(calls,0);
});

test("a deadline stops the active attempt without waiting forever",async()=>{
  let stopped=false;
  await assert.rejects(withinSolverDeadline(()=>new Promise(()=>{}),5,()=>{stopped=true;}),/timeout/);
  assert.equal(stopped,true);
});

test("sibling tasks cannot run primary and fallback concurrently on one lane",async()=>{
  const events:string[]=[];let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const first=withSolverLane(0,async()=>{events.push("primary");await gate;events.push("fallback");});
  const second=withSolverLane(0,async()=>{events.push("sibling");});
  await withSolverLane(1,async()=>{events.push("other lane");});
  assert.deepEqual(events,["primary","other lane"]);release();await Promise.all([first,second]);
  assert.deepEqual(events,["primary","other lane","fallback","sibling"]);
});
