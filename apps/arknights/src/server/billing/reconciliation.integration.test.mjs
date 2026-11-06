import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import test from "node:test";
import process from "node:process";
import { URL } from "node:url";
register("../../../../../scripts/ts-path-loader.mjs", import.meta.url);
registerHooks({ resolve(specifier, context, next) { return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context); } });
const url=process.env.AUTH_INTEGRATION_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test")) throw new Error("An isolated *_test database is required.");
process.env.DATABASE_URL=url;
const {getDatabasePool}=await import("@riic/platform-server/db");

test("reconciliation retains failed page, persists cursor, deduplicates workers and guards history", async t=>{
 const pool=getDatabasePool();const pages=[];let fail=true;let processing=[];
 await t.mock.module(new URL("./afdian.ts",import.meta.url),{namedExports:{afdianApiConfigured:()=>true,queryAfdianOrders:async ({page})=>{pages.push(page);return {list:[{out_trade_no:"page-"+page}],total_page:2}}}});
 await t.mock.module(new URL("./payments.ts",import.meta.url),{namedExports:{processAfdianPayment:async (order,options)=>{if(fail)throw new Error("Transient processing failure");processing.push({order,options});}}});
 const {reconcileAfdianPayments}=await import("./reconciliation.ts");
 const due=()=>pool.query("UPDATE app.billing_reconciliation SET next_run_at=now()-interval '1 second' WHERE provider='afdian'");
 try {
  await pool.query("DELETE FROM app.billing_reconciliation WHERE provider='afdian'");
  await assert.rejects(reconcileAfdianPayments(),/Transient/);
  assert.equal((await pool.query("SELECT next_page FROM app.billing_reconciliation WHERE provider='afdian'")).rows[0].next_page,1);
  assert.equal((await reconcileAfdianPayments()).checked,0);assert.deepEqual(pages,[1]);
  fail=false;await due();await Promise.all([reconcileAfdianPayments(),reconcileAfdianPayments()]);
  assert.deepEqual(pages,[1,1]);assert.equal(processing[0].options.fulfillAfter,undefined);
  assert.equal((await pool.query("SELECT next_page FROM app.billing_reconciliation WHERE provider='afdian'")).rows[0].next_page,2);
  await due();process.env.AFDIAN_RECONCILE_FULFILL_AFTER="2026-11-06T00:00:00Z";
  await reconcileAfdianPayments();assert.deepEqual(pages,[1,1,2]);
  assert.equal(processing[1].options.fulfillAfter.toISOString(),"2026-11-06T00:00:00.000Z");
  assert.equal((await pool.query("SELECT next_page FROM app.billing_reconciliation WHERE provider='afdian'")).rows[0].next_page,1);
  process.env.AFDIAN_RECONCILE_FULFILL_AFTER="bad";await assert.rejects(reconcileAfdianPayments(),/Invalid/);
 } finally {delete process.env.AFDIAN_RECONCILE_FULFILL_AFTER;await pool.query("DELETE FROM app.billing_reconciliation WHERE provider='afdian'");await pool.end();}
});
