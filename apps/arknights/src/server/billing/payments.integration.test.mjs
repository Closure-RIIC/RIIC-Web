import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { register, registerHooks } from "node:module";
import test from "node:test";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { URL, URLSearchParams } from "node:url";
register("../../../../../scripts/ts-path-loader.mjs", import.meta.url);
registerHooks({ resolve(specifier, context, next) { return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context); } });
const url = process.env.AUTH_INTEGRATION_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test")) throw new Error("An explicitly isolated *_test database is required.");
process.env.DATABASE_URL = url;
const { getDatabasePool } = await import("@riic/platform-server/db");
const { processAfdianPayment, afdianPaymentFacts } = await import("./payments.ts");
const { resolveBillingReview, adjustBilling, listBilling } = await import("./admin.ts");
const { getWallet, fulfillBillingOrder } = await import("./service.ts");

async function verifyAdminEmailListings(pool) {
 const prefix="admin-email-"+randomUUID(); const user=prefix+"-user"; const email=prefix+"@example.invalid";
 const run=prefix+"-run"; const deletedRun=prefix+"-deleted-run"; const legacy=prefix+"-legacy";
 const order=prefix+"-order"; const custom=prefix+"-custom";
 const query=(q,extra={})=>new URLSearchParams({q,...extra});
 try {
  await pool.query('INSERT INTO public."user" (id,name,email,email_verified) VALUES ($1,$1,$2,true)',[user,email]);
  await pool.query(`INSERT INTO app.agent_run (id,user_id,conversation_id,idempotency_key,request_hash,policy,rate_version,filter_version)
    VALUES ($1,$3,$1,$1,'test','{}','test','test'),($2,NULL,$2,$2,'test','{}','test','test')`,[run,deletedRun,user]);
  await pool.query(`INSERT INTO app.agent_usage (id,user_id,run_id,tool_name,status,idempotency_key)
    VALUES ($1,$2,$3,'agent_chat','completed',$1)`,[legacy,user,prefix+"-legacy-request"]);
  await pool.query(`INSERT INTO app.billing_ledger (id,user_id,kind,points_delta,paid_points_after,monthly_points_after,idempotency_key)
    VALUES ($1,$2,'admin_credit',1,1,0,$1)`,[prefix+"-ledger",user]);
  await pool.query(`INSERT INTO app.billing_order (id,user_id,product_id,amount_fen,points,custom_order_id,idempotency_key)
    VALUES ($1,$2,'points_5',500,50,$3,$1)`,[order,user,custom]);
  await pool.query(`INSERT INTO app.billing_payment (id,provider,provider_order_id,custom_order_id,order_id,evidence)
    VALUES ($1,'afdian',$1,NULL,$3,'{}'),($2,'afdian',$2,$4,NULL,'{}')`,[prefix+"-linked-payment",prefix+"-referenced-payment",order,custom]);
  await pool.query(`INSERT INTO app.billing_review (id,run_id,kind,status,evidence,created_at)
    SELECT $1||'-review-'||n,$2,'settlement',CASE WHEN n=1 THEN 'resolved' ELSE 'open' END,'{}',now()-n*interval '1 second'
    FROM generate_series(1,27) n`,[prefix,run]);
  await pool.query(`INSERT INTO app.billing_review (id,run_id,kind,evidence) VALUES
    ($1,$2,'missing','{}'),($3,NULL,'afdian_payment',$4),($5,NULL,'afdian_payment',$6),($7,NULL,'afdian_payment','{}')`,
    [prefix+"-deleted-review",deletedRun,prefix+"-linked-review",JSON.stringify({paymentId:prefix+"-linked-payment"}),
      prefix+"-referenced-review",JSON.stringify({paymentId:prefix+"-referenced-payment",customOrderId:custom}),prefix+"-orphan-review"]);
  await pool.query(`INSERT INTO app.agent_filter_event (id,request_id,user_id,version,stage,rule_ids) VALUES
    ($1,$1,$3,'test','input','[]'),($2,$2,NULL,'test','input','[]')`,[prefix+"-filter",prefix+"-deleted-filter",user]);
  await pool.query(`INSERT INTO app.billing_admin_audit (id,actor_id,action,target,reason,idempotency_key,details)
    VALUES ($1,$2,'test',$1,'test',$1,'{}')`,[prefix+"-audit",user]);

  for (const [section,total] of [["usage",2],["ledger",1],["orders",1],["filters",1],["audit",1]]) {
   const listing=await listBilling(section,query(email.toUpperCase()));
   assert.equal(listing.total,total,section+" email search count");
   assert.equal(listing.rows.length,total,section+" email search rows");
   assert.ok(listing.rows.every(row=>(section==="audit"?row.actor_email:row.email)===email),section+" returns email");
  }
  const usage=await listBilling("usage",query(prefix+"-legacy-request"));
  assert.equal(usage.total,1);assert.equal(usage.rows[0].id,legacy);assert.equal(usage.rows[0].email,email);
  const deletedUsage=await listBilling("usage",query(deletedRun));
  assert.equal(deletedUsage.total,1);assert.equal(deletedUsage.rows[0].email,null);
  const first=await listBilling("reviews",query(email));
  const second=await listBilling("reviews",query(email,{page:"2"}));
  assert.equal(first.total,29);assert.equal(first.pages,2);assert.equal(first.rows.length,25);
  assert.equal(second.total,29);assert.equal(second.rows.length,4);
  const reviews=[...first.rows,...second.rows];
  assert.equal(new Set(reviews.map(row=>row.id)).size,29,"joins preserve one row per review across pages");
  assert.ok(reviews.every(row=>row.email===email&&row.user_id===user));
  assert.ok(reviews.some(row=>row.id===prefix+"-linked-review"&&row.run_id===null));
  assert.ok(reviews.some(row=>row.id===prefix+"-referenced-review"&&row.run_id===null));
  const open=await listBilling("reviews",query(email,{status:"open"}));
  assert.equal(open.total,28);assert.ok(open.rows.every(row=>row.status==="open"));
  const request=await listBilling("reviews",query(run));assert.equal(request.total,27);
  for (const id of [prefix+"-deleted-review",prefix+"-orphan-review"]) {
   const unknown=await listBilling("reviews",query(id));
   assert.equal(unknown.total,1);assert.equal(unknown.rows[0].email,null);
  }
  const deletedFilter=await listBilling("filters",query(prefix+"-deleted-filter"));
  assert.equal(deletedFilter.total,1);assert.equal(deletedFilter.rows[0].email,null);
 } finally {
  await pool.query("DELETE FROM app.billing_review WHERE id LIKE $1",[prefix+"%"]);
  await pool.query("DELETE FROM app.billing_payment WHERE id LIKE $1",[prefix+"%"]);
  await pool.query("DELETE FROM app.agent_filter_event WHERE id LIKE $1",[prefix+"%"]);
  await pool.query("DELETE FROM app.billing_admin_audit WHERE id LIKE $1",[prefix+"%"]);
  await pool.query("DELETE FROM app.agent_run WHERE id=ANY($1::text[])",[[run,deletedRun]]);
  await pool.query('DELETE FROM public."user" WHERE id=$1',[user]);
 }
}

test("payments survive missing references, concurrency, closed reviews and historical reconciliation", async t => {
 const pool=getDatabasePool(); const user="payment-test-"+randomUUID(); const prefix="payment-trade-"+randomUUID();
 const order=async (suffix,created=new Date())=>{const id=randomUUID();const custom="riic-"+id.replaceAll("-","").slice(0,24);await pool.query("INSERT INTO app.billing_order (id,user_id,product_id,amount_fen,points,custom_order_id,idempotency_key,created_at) VALUES ($1,$2,'points_5',500,50,$3,$1,$4)",[id,user,custom,created]);return {id,custom,trade:prefix+suffix}};
 const paid=o=>({out_trade_no:o.trade,custom_order_id:o.custom,status:2,total_amount:"5.00"});
 try {
  await pool.query('INSERT INTO public."user" (id,name,email,email_verified) VALUES ($1,$1,$2,true)',[user,user+"@example.invalid"]);
  const orphan={out_trade_no:prefix+"orphan",status:2,total_amount:"5.00",remark:"DIAG-test"};
  await Promise.all(Array.from({length:6},()=>processAfdianPayment(orphan)));
  const payment=(await pool.query("SELECT * FROM app.billing_payment WHERE provider_order_id=$1",[orphan.out_trade_no])).rows[0];
  assert.equal(payment.status,"review");assert.equal(payment.amount_fen,500);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM app.billing_review WHERE id=$1",["payment:"+payment.id])).rows[0].n,1);
  assert.equal((await getWallet(user)).paidPoints,0);
  await resolveBillingReview(user,{id:"payment:"+payment.id,reason:"Cash refund confirmed externally",resolution:"verified"});
  assert.equal((await processAfdianPayment(orphan)).accepted,false);
  assert.equal((await pool.query("SELECT status FROM app.billing_payment WHERE id=$1",[payment.id])).rows[0].status,"closed");
  const normal=await order("normal");
  await Promise.all(Array.from({length:6},()=>processAfdianPayment(paid(normal))));
  assert.equal((await getWallet(user)).paidPoints,50);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM app.billing_ledger WHERE reference_id=$1",[normal.id])).rows[0].n,1);
  assert.equal((await processAfdianPayment({...paid(normal),out_trade_no:prefix+"second-payment"})).accepted,false);
  const other=await order("other");
  await processAfdianPayment({...paid(other),out_trade_no:normal.trade});
  assert.equal((await pool.query("SELECT status FROM app.billing_order WHERE id=$1",[other.id])).rows[0].status,"pending");
  assert.equal((await getWallet(user)).paidPoints,50);
  const old=await order("old",new Date("2020-01-01"));
  assert.equal((await processAfdianPayment(paid(old),{source:"reconciliation"})).accepted,false);
  assert.equal((await processAfdianPayment(paid(old),{source:"reconciliation",fulfillAfter:new Date("2026-01-01")})).accepted,false);
  process.env.AFDIAN_RECONCILE_FULFILL_AFTER="2026-01-01T00:00:00Z";
  assert.equal((await processAfdianPayment(paid(old))).accepted,false,"configured cutoff also protects old webhook replay");
  delete process.env.AFDIAN_RECONCILE_FULFILL_AFTER;
  const missed=await order("missed");
  assert.equal((await processAfdianPayment(paid(missed),{source:"reconciliation",fulfillAfter:new Date("2026-01-01")})).accepted,true);
  assert.equal((await getWallet(user)).paidPoints,100);
  const bad=await order("bad");
  assert.equal((await processAfdianPayment({...paid(bad),total_amount:"5.001"})).accepted,false);
  assert.equal(afdianPaymentFacts({...paid(bad),total_amount:"5.001"}).amountFen,null);
  const mismatch=await order("mismatch");
  assert.equal((await processAfdianPayment({...paid(mismatch),total_amount:"10"})).accepted,false);
  await processAfdianPayment({...paid(mismatch),custom_order_id:undefined,total_amount:"10"});
  await sleep(5); // Cross a millisecond boundary so created_at stays below the listing window's default "to".
  assert.equal((await listBilling("reviews",new URLSearchParams({q:mismatch.custom}))).total,1,"replay without a reference preserves searchable evidence");
  const recover=await order("recover");
  await processAfdianPayment({...paid(recover),custom_order_id:undefined});
  assert.equal((await processAfdianPayment(paid(recover))).accepted,true);
  const rp=(await pool.query("SELECT id FROM app.billing_payment WHERE provider_order_id=$1",[recover.trade])).rows[0];
  assert.equal((await pool.query("SELECT status FROM app.billing_review WHERE id=$1",["payment:"+rp.id])).rows[0].status,"resolved");
  assert.equal((await getWallet(user)).paidPoints,150);
  const manual = {out_trade_no:prefix+"manual",status:2,total_amount:"5.00"};
  await processAfdianPayment(manual);
  await sleep(5); // Cross a millisecond boundary so created_at stays below the listing window's default "to".
  const search = await listBilling("reviews",new URLSearchParams({q:manual.out_trade_no}));
  assert.equal(search.total,1,"review search accepts the actual provider transaction");
  const adjustment = {userId:user,action:"credit",providerOrderId:manual.out_trade_no,points:50,reason:"Buyer and payment verified",idempotencyKey:prefix+"manual-adjust"};
  const credited = await adjustBilling(user,adjustment);
  assert.equal((await adjustBilling(user,adjustment)).duplicate,true);
  await assert.rejects(adjustBilling(user,{...adjustment,idempotencyKey:prefix+"manual-again"}));
  assert.equal((await processAfdianPayment(manual)).idempotent,true);
  assert.equal((await getWallet(user)).paidPoints,200,"manual recovery and subsequent callbacks only credit once");
  assert.equal((await pool.query("SELECT reference_id FROM app.billing_ledger WHERE id=$1",[credited.ledgerId])).rows[0].reference_id,manual.out_trade_no);
  const prepared = await order("prepared-before-manual");
  await processAfdianPayment({...paid(prepared),total_amount:"10"});
  const preparedPayment=(await pool.query("SELECT id FROM app.billing_payment WHERE provider_order_id=$1",[prepared.trade])).rows[0];
  await pool.query("UPDATE app.billing_payment SET amount_fen=500 WHERE id=$1",[preparedPayment.id]);
  await adjustBilling(user,{...adjustment,providerOrderId:prepared.trade,idempotencyKey:prefix+"prepared-manual"});
  await assert.rejects(fulfillBillingOrder({customOrderId:prepared.custom,providerOrderId:prepared.trade,amountFen:500,paymentId:preparedPayment.id}),"a callback prepared before manual credit must recheck the locked payment");
  assert.equal((await getWallet(user)).paidPoints,250);
  assert.equal((await pool.query("SELECT status FROM app.billing_order WHERE id=$1",[prepared.id])).rows[0].status,"pending");
  const conflict=await order("conflict");
  await processAfdianPayment({...paid(conflict),total_amount:"10"});
  assert.equal((await processAfdianPayment({...paid(other),out_trade_no:conflict.trade,total_amount:"10"})).accepted,false);
  assert.equal((await pool.query("SELECT custom_order_id FROM app.billing_payment WHERE provider_order_id=$1",[conflict.trade])).rows[0].custom_order_id,conflict.custom,"a changed provider reference cannot reassign existing payment");
  const closed=await order("closed");
  await processAfdianPayment({...paid(closed),custom_order_id:undefined});
  const cp=(await pool.query("SELECT id FROM app.billing_payment WHERE provider_order_id=$1",[closed.trade])).rows[0];
  await resolveBillingReview(user,{id:"payment:"+cp.id,reason:"Refunded",resolution:"verified"});
  assert.equal((await processAfdianPayment(paid(closed))).accepted,false,"even a recovered reference cannot reopen closed payments");
  const race=await order("race");
  await processAfdianPayment({...paid(race),custom_order_id:undefined});
  const racePayment=(await pool.query("SELECT id FROM app.billing_payment WHERE provider_order_id=$1",[race.trade])).rows[0];
  const results=await Promise.allSettled([processAfdianPayment(paid(race)),resolveBillingReview(user,{id:"payment:"+racePayment.id,reason:"Concurrent review",resolution:"verified"})]);
  assert.equal(results.every(r=>r.status==="fulfilled"),true,"payment/review lock ordering must not deadlock");
  const final=(await pool.query("SELECT status FROM app.billing_payment WHERE id=$1",[racePayment.id])).rows[0].status;
  assert.ok(["closed","fulfilled"].includes(final));
  await t.test("admin billing lists return and search emails without dropping unidentified records",()=>verifyAdminEmailListings(pool));
 } finally {
  delete process.env.AFDIAN_RECONCILE_FULFILL_AFTER;
  await pool.query("DELETE FROM app.billing_admin_audit WHERE actor_id=$1",[user]);
  await pool.query("DELETE FROM app.billing_review WHERE id IN (SELECT 'payment:'||id FROM app.billing_payment WHERE provider_order_id LIKE $1)",[prefix+"%"]);
  await pool.query("DELETE FROM app.billing_payment WHERE provider_order_id LIKE $1",[prefix+"%"]);
  await pool.query('DELETE FROM public."user" WHERE id=$1',[user]);await pool.end();
 }
});
