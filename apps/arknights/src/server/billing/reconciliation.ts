import "@tanstack/react-start/server-only";
import { getDatabasePool } from "@riic/platform-server/db";
import { afdianApiConfigured, queryAfdianOrders } from "./afdian.ts";
import { processAfdianPayment } from "./payments.ts";

/** One durable page per run; multiple workers share the same database lock/cursor. */
export async function reconcileAfdianPayments() {
  if (!afdianApiConfigured()) return { checked: 0 };
  const raw = process.env.AFDIAN_RECONCILE_FULFILL_AFTER?.trim();
  const fulfillAfter = raw ? new Date(raw) : undefined;
  if (fulfillAfter && !Number.isFinite(+fulfillAfter)) throw new Error("Invalid AFDIAN_RECONCILE_FULFILL_AFTER.");
  const client = await getDatabasePool().connect();
  let locked = false;
  let destroyed = false;
  try {
    locked = (await client.query("SELECT pg_try_advisory_lock(hashtext('riic-afdian-reconcile')) AS locked")).rows[0].locked;
    if (!locked) return { checked: 0 };
    await client.query("INSERT INTO app.billing_reconciliation (provider) VALUES ('afdian') ON CONFLICT DO NOTHING");
    const cursor = (await client.query("SELECT next_page,next_run_at<=now() AS due FROM app.billing_reconciliation WHERE provider='afdian'")).rows[0];
    if (!cursor.due) return { checked: 0 };
    // Set retry delay before network work; a crash retries this same page.
    await client.query("UPDATE app.billing_reconciliation SET next_run_at=now()+interval '5 minutes' WHERE provider='afdian'");
    const data = await queryAfdianOrders({ page: cursor.next_page });
    if (!Array.isArray(data?.list) || typeof data.total_page !== "number" || !Number.isSafeInteger(data.total_page) || data.total_page < 0) throw new Error("Invalid reconciliation page.");
    for (const order of data.list) await processAfdianPayment(order, { source: "reconciliation", fulfillAfter });
    const next = cursor.next_page >= Math.max(1, data.total_page) ? 1 : cursor.next_page + 1;
    await client.query("UPDATE app.billing_reconciliation SET next_page=$1,next_run_at=now()+interval '5 minutes',updated_at=now() WHERE provider='afdian'", [next]);
    return { checked: data.list.length, page: cursor.next_page, nextPage: next };
  } finally {
    if (locked) {
      try { await client.query("SELECT pg_advisory_unlock(hashtext('riic-afdian-reconcile'))"); }
      catch { client.release(true); destroyed = true; }
    }
    if (!destroyed) client.release();
  }
}
