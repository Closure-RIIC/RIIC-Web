import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { register, registerHooks } from "node:module";
import process from "node:process";
import test from "node:test";
import { URL, URLSearchParams } from "node:url";
register("../../../../../scripts/ts-path-loader.mjs", import.meta.url);
registerHooks({ resolve(specifier, context, next) {
  return ["server-only", "@tanstack/react-start/server-only"].includes(specifier)
    ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(specifier, context);
} });
const url = process.env.AUTH_INTEGRATION_DATABASE_URL;
if (!url || !/^\/riic_monthly_[a-f0-9]{32}_test$/.test(new URL(url).pathname)) throw new Error("An isolated riic_monthly_<UUID>_test database is required");
process.env.DATABASE_URL = url;
const { getDatabasePool } = await import("@riic/platform-server/db");
const { billingMonthly, billingMonthlyRange, BillingMonthlyError } = await import("./monthly-report.ts");
const pool = getDatabasePool();

test("monthly report uses Beijing month boundaries, exact decimals, empty buckets and unduplicated provider costs", async () => {
  const user = `monthly-${randomUUID()}`;
  try {
    await pool.query('INSERT INTO public."user" (id,name,email) VALUES ($1,$1,$2)', [user, `${user}@example.invalid`]);
    const usage = async (at, points, cost, version, id = randomUUID(), runId = null) => {
      await pool.query(`INSERT INTO app.agent_usage
        (id,user_id,run_id,tool_name,status,points,upstream_cost_rmb_fen,idempotency_key,metadata,created_at)
        VALUES ($1,$2,$3,'agent_chat','completed',$4,$5,$1,$6,$7)`,
      [id, user, runId, points, cost, JSON.stringify(version == null ? {} : { billingVersion: version }), at]);
      return id;
    };
    const run = async () => {
      const id = randomUUID();
      await pool.query(`INSERT INTO app.agent_run (id,user_id,conversation_id,idempotency_key,request_hash,policy,rate_version,filter_version,state)
        VALUES ($1,$2,$1,$1,'fixture','{}','rates:fixture','filter:fixture','failed')`, [id, user]);
      return id;
    };
    const call = async (runId, step, at, rmb, status = "measured") => pool.query(`INSERT INTO app.agent_model_call
      (id,run_id,step,budget_points,rate_version,upstream_rmb,status,created_at) VALUES ($1,$2,$3,1,'fixture',$4,$5,$6)`, [randomUUID(), runId, step, rmb, status, at]);
    const order = async (paidAt, amount, status = "paid") => {
      const id = randomUUID();
      await pool.query(`INSERT INTO app.billing_order (id,user_id,product_id,status,amount_fen,points,custom_order_id,idempotency_key,created_at,paid_at)
        VALUES ($1,$2,'fixture',$3,$4,1,$1,$1,'2026-01-01T00:00:00+08:00',$5)`, [id, user, status, amount, paidAt]);
    };
    // Last millisecond of 2025 in Beijing, despite still being Dec 31 UTC.
    await usage("2025-12-31T23:59:59.999+08:00", "0.0001", "0.0000000001");
    await usage("2026-01-01T00:00:00+08:00", "0.0002", "0.0000000002");
    await usage("2026-01-31T23:59:59.999+08:00", "0.0003", null);
    const modern = await run();
    // Summary's 999 fen must not be added to the two actual calls (15 fen).
    await usage("2026-01-10T00:00:00+08:00", "0.1234", "999", 5, modern, modern);
    await call(modern, 0, "2026-01-10T00:00:00+08:00", "0.100000000001");
    await call(modern, 1, "2026-01-10T00:00:01+08:00", "0.05");
    await call(modern, 2, "2026-01-10T00:00:02+08:00", null, "waived");
    const future = await run();
    await usage("2026-01-11T00:00:00+08:00", "0.2000", "888", 6, future, future);
    await call(future, 0, "2026-01-11T00:00:00+08:00", "0.01");
    // Failed/unsettled runs may incur real provider costs without a usage summary.
    const failed = await run();
    await call(failed, 0, "2026-01-12T00:00:00+08:00", "0.02");
    await call(failed, 1, "2026-01-12T00:00:01+08:00", null, "missing");
    await call(failed, 2, "2026-01-12T00:00:02+08:00", null, "started");
    // The newer usage summary is not a cost source when no model call exists.
    await usage("2026-01-13T00:00:00+08:00", "0.3000", "777", 4);
    await usage("2026-03-01T00:00:00+08:00", "100", "100"); // to is exclusive
    await order("2025-12-31T23:59:59.999+08:00", 100);
    await order("2026-01-01T00:00:00+08:00", 200);
    await order("2026-01-31T23:59:59.999+08:00", 300);
    await order("2026-01-15T00:00:00+08:00", 900, "pending");
    await order("2026-03-01T00:00:00+08:00", 1000);
    const report = await billingMonthly(new Date("2025-12-01T00:00:00+08:00"), new Date("2026-03-01T00:00:00+08:00"));
    assert.equal(report.timezone, "Asia/Shanghai");
    assert.deepEqual(report.months.map(row => row.month), ["2025-12", "2026-01", "2026-02"]);
    assert.deepEqual(report.months.map(row => row.runs), [1, 5, 0]);
    assert.deepEqual(report.months.map(row => row.paid_orders), [1, 2, 0]);
    assert.deepEqual(report.months.map(row => row.paid_fen), ["100", "500", "0"]);
    assert.equal(report.months[0].points, "0.0001");
    assert.equal(report.months[1].points, "0.6239");
    assert.equal(report.months[1].known_cost_fen, "18.000000000300");
    assert.equal(report.months[1].unknown_cost_runs, 2); // one legacy record + one failed run
    assert.equal(report.months[1].unknown_cost_calls, 2); // waived calls are known free
    assert.deepEqual(report.months[2], { month: "2026-02", runs: 0, points: "0", paid_orders: 0, paid_fen: "0", known_cost_fen: "0", unknown_cost_runs: 0, unknown_cost_calls: 0 });
    const partial = await billingMonthly(new Date("2026-01-15T00:00:00+08:00"), new Date("2026-02-01T00:00:00+08:00"));
    assert.equal(partial.months.length, 1); assert.equal(partial.months[0].runs, 1); assert.equal(partial.months[0].paid_fen, "300");
  } finally {
    await pool.query("DELETE FROM app.agent_model_call WHERE run_id IN (SELECT id FROM app.agent_run WHERE user_id=$1)", [user]);
    await pool.query("DELETE FROM app.agent_run WHERE user_id=$1", [user]);
    await pool.query('DELETE FROM public."user" WHERE id=$1', [user]);
  }
});

test("monthly defaults span twelve calendar months including current partial month; invalid dates never query", async () => {
  const normal = billingMonthlyRange(new URLSearchParams(), new Date("2026-11-21T14:30:00+08:00"));
  assert.equal(normal.from.toISOString(), "2025-11-30T16:00:00.000Z");
  assert.equal(normal.to.toISOString(), "2026-11-21T06:30:00.000Z");
  const atBoundary = billingMonthlyRange(new URLSearchParams("to=2026-01-01T00:00:00%2B08:00"));
  assert.equal(atBoundary.from.toISOString(), "2024-12-31T16:00:00.000Z");
  for (const query of ["from=bad", "to=bad", "from=2026-02-01&to=2026-01-01", "from=2024-01-01&to=2026-01-01"]) {
    assert.throws(() => billingMonthlyRange(new URLSearchParams(query)), BillingMonthlyError);
  }
  await assert.rejects(billingMonthly(new Date("invalid"), new Date()), BillingMonthlyError);
  await assert.rejects(billingMonthly(new Date("2024-01-01"), new Date("2026-01-01")), BillingMonthlyError);
});

test.after(async () => { await pool.end(); });
