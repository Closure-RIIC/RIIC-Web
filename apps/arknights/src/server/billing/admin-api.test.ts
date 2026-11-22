import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import test from "node:test";
register("../../../../../scripts/ts-path-loader.mjs", import.meta.url);
registerHooks({ resolve(specifier, context, next) { return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context); } });
test("billing APIs reject guests, reviewers and cross-origin writes before accessing accounts", async t => {
  let role="guest";let originAllowed=true;const calls:string[]=[];
  class PublicApiError extends Error {} class BillingAdminError extends Error {}
  await t.mock.module(new URL("../../../../../packages/platform-server/src/api-contract.ts",import.meta.url),{namedExports:{PublicApiError,createRequestId:()=>"test",
    assertSameOrigin:()=>{calls.push("origin");if(!originAllowed)throw new Error("origin denied");},enforceRateLimit:()=>{calls.push("rate");},readJsonBody:(r:Request)=>r.json(),
    successResponse:(data:unknown)=>Response.json({data}),failureResponse:()=>Response.json({error:"denied"},{status:403})}});
  await t.mock.module(new URL("../../../../../packages/platform-server/src/auth/authorization.ts",import.meta.url),{namedExports:{requireWebsiteAdmin:async()=>{calls.push("auth");if(role!=="admin")throw new Error("denied");return {session:{user:{id:"real-admin"}}};}}});
  await t.mock.module(new URL("../../../../../packages/platform-server/src/referral/service.ts",import.meta.url),{namedExports:{ReferralError:class extends Error {},getReferralCampaign:()=>{calls.push("referral-read");return{};},setReferralCampaign:(actor:string)=>{assert.equal(actor,"real-admin");calls.push("referral-write");return{};}}});
  await t.mock.module(new URL("./admin.ts",import.meta.url),{namedExports:{BillingAdminError,billingRange:()=>({from:new Date(),to:new Date()}),
    billingOverview:(...args:unknown[])=>{assert.equal(args.length,2);calls.push("read");return{};},listBilling:()=>{calls.push("read");return{};},billingRunDetail:()=>({}),getAgentPolicies:()=>({}),
    adjustBilling:(actor:string)=>{assert.equal(actor,"real-admin");calls.push("write");return{};},changeAgentPolicy:()=>({}),
    changeAgentModelSettings:(actor:string,body:unknown)=>{assert.equal(actor,"real-admin");assert.deepEqual(body,{actor:"forged",expectedActive:{ratesId:"rates:1",modelsId:"models:1"}});calls.push("settings-write");return{id:"model-settings:2"};},resolveBillingReview:()=>({}),testAgentFilter:()=>({})}});
  const {GET,POST}=await import("../../app/api/admin/billing/route.ts");
  const write=()=>new Request("https://riic.test/api/admin/billing?section=adjust",{method:"POST",body:JSON.stringify({actor:"forged"})});
  const settingsWrite=()=>new Request("https://riic.test/api/admin/billing?section=model-settings",{method:"POST",body:JSON.stringify({actor:"forged",expectedActive:{ratesId:"rates:1",modelsId:"models:1"}})});
  for(role of ["guest","user","reviewer"]){calls.length=0;assert.equal((await POST(write())).status,403);assert.deepEqual(calls,["auth"]);assert.equal((await GET(new Request("https://riic.test/api/admin/billing?section=wallets"))).status,403);}
  role="admin";originAllowed=false;calls.length=0;assert.equal((await POST(write())).status,403);assert.deepEqual(calls,["auth","origin"]);
  originAllowed=true;calls.length=0;assert.equal((await POST(write())).status,200);assert.deepEqual(calls,["auth","origin","rate","write"]);
  const referralWrite=()=>new Request("https://riic.test/api/admin/billing?section=referral",{method:"POST",body:JSON.stringify({enabled:true,actor:"forged"})});
  for(role of ["guest","user","reviewer"]){calls.length=0;assert.equal((await POST(referralWrite())).status,403);assert.deepEqual(calls,["auth"]);}
  role="admin";originAllowed=false;calls.length=0;assert.equal((await POST(referralWrite())).status,403);assert.deepEqual(calls,["auth","origin"]);
  originAllowed=true;calls.length=0;assert.equal((await POST(referralWrite())).status,200);assert.deepEqual(calls,["auth","origin","rate","referral-write"]);
  calls.length=0;assert.equal((await GET(new Request("https://riic.test/api/admin/billing?section=referral"))).status,200);assert.deepEqual(calls,["auth","referral-read"]);
  for(role of ["guest","user","reviewer"]){calls.length=0;assert.equal((await POST(settingsWrite())).status,403);assert.deepEqual(calls,["auth"]);}
  role="admin";originAllowed=false;calls.length=0;assert.equal((await POST(settingsWrite())).status,403);assert.deepEqual(calls,["auth","origin"]);
  originAllowed=true;calls.length=0;const settingsResponse=await POST(settingsWrite());assert.equal(settingsResponse.status,200);assert.deepEqual(calls,["auth","origin","rate","settings-write"]);
  assert.deepEqual(await settingsResponse.json(),{data:{id:"model-settings:2"}});assert.match(settingsResponse.headers.get("Cache-Control")!,/private, no-store/);
  const response=await GET(new Request("https://riic.test/api/admin/billing?section=summary&q=hidden-user&status=failed"));assert.match(response.headers.get("Cache-Control")!,/private, no-store/);
});
