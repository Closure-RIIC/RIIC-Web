import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import test from "node:test";
import process from "node:process";
import { URL } from "node:url";
const {Request}=globalThis;

register("../../../../scripts/ts-path-loader.mjs",import.meta.url);
const hook=registerHooks({resolve(specifier,context,next){
  if(specifier==="server-only")return {shortCircuit:true,url:"data:text/javascript,export{}"};
  return next(specifier,context);
}});
process.once("exit",()=>hook.deregister());

test("diagnostic endpoint authorizes before reading, bounds time ranges and disables caching",async context=>{
  const {PublicApiError}=await import("@riic/platform-server/api-contract");
  let authenticated=false;
  const reads=[];
  await context.mock.module(new URL("../../../../packages/platform-server/src/auth/authorization.ts",import.meta.url),{namedExports:{
    requireWebsiteReviewer:async()=>{if(!authenticated)throw new PublicApiError("AIC-AUTH-2008");return {session:{user:{id:"test-admin"}}};},
  }});
  const diagnostics=await import("@riic/platform-server/request-diagnostics");
  await context.mock.module(new URL("../../../../packages/platform-server/src/request-diagnostics.ts",import.meta.url),{namedExports:{
    ...diagnostics,readDiagnostics:async hours=>{reads.push(hours);return {total:0,groups:[],recent:[]};},
  }});
  const {GET}=await import("../app/api/admin/diagnostics/route.ts");
  let response=await GET(new Request("https://test.invalid/api/admin/diagnostics"));
  assert.equal(response.status,401); assert.equal(reads.length,0);
  assert.equal(response.headers.get("Cache-Control"),"private, no-store");
  authenticated=true;
  response=await GET(new Request("https://test.invalid/api/admin/diagnostics?hours=999999"));
  assert.equal(response.status,400); assert.equal(reads.length,0);
  response=await GET(new Request("https://test.invalid/api/admin/diagnostics?hours=24"));
  assert.equal(response.status,200); assert.deepEqual(reads,[24]);
  assert.equal(response.headers.get("Cache-Control"),"private, no-store");
});
