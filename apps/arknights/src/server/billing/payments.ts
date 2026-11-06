import "@tanstack/react-start/server-only";
import { randomUUID } from "node:crypto";
import { Decimal } from "decimal.js";
import { getDatabasePool } from "@riic/platform-server/db";
import { billingTransaction } from "./agent-accounting.ts";
import { BillingError, fulfillBillingOrder } from "./service.ts";
import type { AfdianOrder } from "./afdian.ts";

type Payment = { id: string; status: string; order_id: string | null; custom_order_id: string | null; amount_fen: number | null; conflict?: boolean };
export function afdianPaymentFacts(order: AfdianOrder): { trade: string; customOrderId: string | null; amountFen: number | null; providerStatus: number | null } {
  if (typeof order.out_trade_no !== "string" || !order.out_trade_no.trim() || order.out_trade_no.length > 128) throw new Error("Invalid verified payment transaction.");
  const references = [order.custom_order_id, order.remark]
    .filter((value): value is string => typeof value === "string" && /^riic-[a-z0-9]+$/i.test(value.trim()))
    .map(value => value.trim());
  let amountFen: number | null = null;
  try {
    if (order.total_amount !== undefined && order.total_amount !== null && order.total_amount !== "") {
      const amount = new Decimal(order.total_amount).times(100);
      if (amount.isInteger() && amount.gte(0) && amount.lte(2_147_483_647)) amountFen = amount.toNumber();
    }
  } catch { /* Malformed amounts remain reviewable, never rounded into payment. */ }
  return { trade: order.out_trade_no, customOrderId: references[0] ?? null, amountFen,
    providerStatus: Number.isSafeInteger(order.status) ? order.status! : null };
}

async function openPaymentReview(paymentId: string, evidence: Record<string, unknown>) {
  return billingTransaction(async client => {
    const payment = (await client.query<Payment>("SELECT id,status,order_id FROM app.billing_payment WHERE id=$1 FOR UPDATE", [paymentId])).rows[0];
    if (!payment || ["fulfilled", "closed"].includes(payment.status)) return;
    await client.query("UPDATE app.billing_payment SET status='review',updated_at=now() WHERE id=$1", [paymentId]);
    await client.query("INSERT INTO app.billing_review (id,kind,evidence) VALUES ($1,'afdian_payment',$2) ON CONFLICT (id) DO UPDATE SET evidence=EXCLUDED.evidence WHERE app.billing_review.status='open'",
      ["payment:" + paymentId, JSON.stringify({ ...evidence, paymentId })]);
  });
}

/** Input must come from the authenticated provider API, never callback fields. */
export async function processAfdianPayment(order: AfdianOrder, options: { source: "webhook" | "reconciliation"; fulfillAfter?: Date } = { source: "webhook" }) {
  const facts = afdianPaymentFacts(order);
  const configuredCutoff = process.env.AFDIAN_RECONCILE_FULFILL_AFTER?.trim();
  const cutoff = options.fulfillAfter ?? (configuredCutoff ? new Date(configuredCutoff) : undefined);
  if (cutoff && !Number.isFinite(+cutoff)) throw new Error("Invalid AFDIAN_RECONCILE_FULFILL_AFTER.");
  const evidence = { ...facts, source: options.source, planId: order.plan_id ?? null,
    providerBuyerId: order.user_id ?? null, remark: typeof order.remark === "string" ? order.remark.slice(0, 2000) : null };
  const payment = await billingTransaction(async client => {
    await client.query("INSERT INTO app.billing_payment (id,provider,provider_order_id,custom_order_id,amount_fen,provider_status,evidence) VALUES ($1,'afdian',$2,$3,$4,$5,$6) ON CONFLICT (provider,provider_order_id) DO NOTHING",
      [randomUUID(), facts.trade, facts.customOrderId, facts.amountFen, facts.providerStatus, JSON.stringify(evidence)]);
    const row = (await client.query<Payment>("SELECT id,status,order_id,custom_order_id,amount_fen FROM app.billing_payment WHERE provider='afdian' AND provider_order_id=$1 FOR UPDATE", [facts.trade])).rows[0];
    if (!["fulfilled", "closed"].includes(row.status)) {
      if ((row.custom_order_id && facts.customOrderId && row.custom_order_id !== facts.customOrderId)
        || (row.amount_fen !== null && facts.amountFen !== null && row.amount_fen !== facts.amountFen)) {
        row.conflict = true;
        return row;
      }
      facts.customOrderId ??= row.custom_order_id;
      evidence.customOrderId = facts.customOrderId;
      await client.query("UPDATE app.billing_payment SET custom_order_id=$2,amount_fen=coalesce($3,amount_fen),provider_status=$4,evidence=$5,updated_at=now() WHERE id=$1",
        [row.id, facts.customOrderId, facts.amountFen, facts.providerStatus, JSON.stringify(evidence)]);
      // Existing manual recovery and paid orders are payment evidence, too.
      const settled = await client.query("SELECT id FROM app.billing_order WHERE provider='afdian' AND provider_order_id=$1 AND status='paid' UNION ALL SELECT id FROM app.billing_ledger WHERE points_delta>0 AND (metadata->>'providerOrderId'=$1 OR (reference_type='afdian_order' AND reference_id=$1)) LIMIT 1", [facts.trade]);
      if (settled.rowCount) {
        await client.query("UPDATE app.billing_payment SET status='fulfilled',updated_at=now() WHERE id=$1", [row.id]);
        await client.query("UPDATE app.billing_review SET status='resolved',resolution='previously_fulfilled',resolved_at=now() WHERE id=$1 AND status='open'", ["payment:" + row.id]);
        row.status = "fulfilled";
      }
    }
    return row;
  });
  if (["fulfilled", "closed"].includes(payment.status)) return { accepted: payment.status === "fulfilled", recorded: true, idempotent: true, paymentId: payment.id };
  if (facts.providerStatus !== 2) return { accepted: false, recorded: true, paymentId: payment.id, reason: "payment_not_success" };
  let reason = payment.conflict ? "provider_facts_conflict" : !facts.customOrderId ? "missing_reference" : facts.amountFen === null ? "invalid_amount" : "";
  if (!reason && (options.source === "reconciliation" || cutoff)) {
    const local = await getDatabasePool().query("SELECT created_at FROM app.billing_order WHERE custom_order_id=$1", [facts.customOrderId]);
    if (!cutoff || !local.rowCount || new Date(local.rows[0].created_at) < cutoff) reason = "historical_payment_requires_review";
  }
  if (!reason) {
    try {
      const result = await fulfillBillingOrder({ customOrderId: facts.customOrderId!, providerOrderId: facts.trade, amountFen: facts.amountFen!, paymentId: payment.id });
      return { accepted: true, recorded: true, idempotent: result.idempotent, paymentId: payment.id };
    } catch (error) {
      const pgError = error as { code?: string; cause?: { code?: string } };
      if (error instanceof BillingError || pgError.code === "23505" || pgError.cause?.code === "23505") reason = "local_order_conflict";
      else throw error; // Durable payment remains; retries recover transient errors.
    }
  }
  await openPaymentReview(payment.id, { ...evidence, reason });
  return { accepted: false, recorded: true, paymentId: payment.id, reason };
}
