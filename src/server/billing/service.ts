import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";

import { getDatabase } from "@/server/db";
import { agentUsage, billingCdk, billingLedger, billingOrder, billingWallet } from "@/server/db/schema";
import { afdianCheckoutUrl, billingProduct, billingTestProductEnabled, type BillingProduct } from "./config";
import { cdkAvailability, hashCdk, randomCdk, validCdk } from "./cdk";

export type BillingWalletView = {
  paidPoints: number;
  monthlyPoints: number;
  monthlyExpiresAt: string | null;
  totalPoints: number;
  reservedPoints: number;
};

export class BillingError extends Error {
  constructor(public readonly code: "invalid_product" | "insufficient_points" | "order_not_payable" | "invalid_cdk" | "checkout_unavailable", message: string) {
    super(message);
    this.name = "BillingError";
  }
}

type LockedWallet = {
  paidPoints: number;
  monthlyPoints: number;
  monthlyExpiresAt: Date | null;
  heldPaidPoints?: number;
  heldMonthlyPoints?: number;
};

type BillingTransaction = Parameters<Parameters<ReturnType<typeof getDatabase>["transaction"]>[0]>[0];

function viewWallet(wallet: LockedWallet): BillingWalletView {
  const monthlyActive = wallet.monthlyExpiresAt && wallet.monthlyExpiresAt.getTime() > Date.now();
  const monthlyPoints = monthlyActive ? wallet.monthlyPoints : 0;
  return {
    paidPoints: wallet.paidPoints,
    monthlyPoints,
    monthlyExpiresAt: monthlyActive ? wallet.monthlyExpiresAt!.toISOString() : null,
    totalPoints: Math.max(0, wallet.paidPoints - (wallet.heldPaidPoints ?? 0)) + Math.max(0, monthlyPoints - (wallet.heldMonthlyPoints ?? 0)),
    reservedPoints: (wallet.heldPaidPoints ?? 0) + (wallet.heldMonthlyPoints ?? 0),
  };
}

async function ensureWallet(tx: BillingTransaction, userId: string): Promise<void> {
  await tx.insert(billingWallet).values({ userId }).onConflictDoNothing({ target: billingWallet.userId });
}

async function lockWallet(tx: BillingTransaction, userId: string): Promise<LockedWallet> {
  const result = await tx.execute(sql`
    SELECT "paid_points" AS "paidPoints", "monthly_points" AS "monthlyPoints", "monthly_expires_at" AS "monthlyExpiresAt",
      "held_paid_points" AS "heldPaidPoints", "held_monthly_points" AS "heldMonthlyPoints"
    FROM "app"."billing_wallet"
    WHERE "user_id" = ${userId}
    FOR UPDATE
  `);
  const row = (result as { rows: Array<Record<string, unknown>> }).rows[0];
  if (!row) throw new Error("计费钱包不存在。");
  return {
    paidPoints: Number(row.paidPoints ?? 0),
    monthlyPoints: Number(row.monthlyPoints ?? 0),
    monthlyExpiresAt: row.monthlyExpiresAt ? new Date(String(row.monthlyExpiresAt)) : null,
    heldPaidPoints: Number(row.heldPaidPoints ?? 0), heldMonthlyPoints: Number(row.heldMonthlyPoints ?? 0),
  };
}

async function expireWalletIfNeeded(tx: BillingTransaction, userId: string, wallet: LockedWallet): Promise<LockedWallet> {
  if (!wallet.monthlyExpiresAt || wallet.monthlyExpiresAt.getTime() > Date.now() || wallet.monthlyPoints <= (wallet.heldMonthlyPoints ?? 0)) return wallet;
  const remaining = wallet.heldMonthlyPoints ?? 0;
  const next = { ...wallet, monthlyPoints: remaining, monthlyExpiresAt: remaining ? wallet.monthlyExpiresAt : null };
  await tx.update(billingWallet).set({ monthlyPoints: remaining, monthlyExpiresAt: next.monthlyExpiresAt, updatedAt: new Date() }).where(eq(billingWallet.userId, userId));
  await tx.insert(billingLedger).values({ id: randomUUID(), userId, kind: "monthly_expiry", pointsDelta: remaining - wallet.monthlyPoints,
    paidPointsAfter: wallet.paidPoints, monthlyPointsAfter: remaining, idempotencyKey: `monthly_expiry:${userId}:${wallet.monthlyExpiresAt.toISOString()}` });
  return next;
}

export async function getWallet(userId: string): Promise<BillingWalletView> {
  const db = getDatabase();
  return db.transaction(async (tx) => {
    await ensureWallet(tx, userId);
    const wallet = await lockWallet(tx, userId);
    return viewWallet(await expireWalletIfNeeded(tx, userId, wallet));
  });
}

export function listBillingProducts(): readonly (BillingProduct & { checkoutConfigured: boolean })[] {
  return [...(billingTestProductEnabled() ? ["points_1_test"] : []), "points_5", "points_10", "monthly_19_9"]
    .map((id) => billingProduct(id))
    .filter((product): product is BillingProduct => Boolean(product))
    .map((product) => ({ ...product, checkoutConfigured: Boolean(afdianCheckoutUrl(product.id)) }));
}

export async function listLedger(userId: string, limit = 40) {
  const rows = await getDatabase()
    .select({
      id: billingLedger.id,
      kind: billingLedger.kind,
      pointsDelta: billingLedger.pointsDelta,
      referenceType: billingLedger.referenceType,
      referenceId: billingLedger.referenceId,
      metadata: billingLedger.metadata,
      createdAt: billingLedger.createdAt,
    })
    .from(billingLedger)
    .where(eq(billingLedger.userId, userId))
    .orderBy(desc(billingLedger.createdAt))
    .limit(Math.max(1, Math.min(limit, 100)));
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

export async function listOrders(userId: string, limit = 20) {
  const rows = await getDatabase()
    .select({
      id: billingOrder.id,
      productId: billingOrder.productId,
      provider: billingOrder.provider,
      status: billingOrder.status,
      amountFen: billingOrder.amountFen,
      points: billingOrder.points,
      customOrderId: billingOrder.customOrderId,
      paymentUrl: billingOrder.paymentUrl,
      createdAt: billingOrder.createdAt,
      paidAt: billingOrder.paidAt,
    })
    .from(billingOrder)
    .where(eq(billingOrder.userId, userId))
    .orderBy(desc(billingOrder.createdAt))
    .limit(Math.max(1, Math.min(limit, 50)));
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    paidAt: row.paidAt?.toISOString() ?? null,
  }));
}

export async function getOrder(userId: string, orderId: string) {
  const [row] = await getDatabase().select({
    id: billingOrder.id, productId: billingOrder.productId, provider: billingOrder.provider, status: billingOrder.status,
    amountFen: billingOrder.amountFen, points: billingOrder.points, customOrderId: billingOrder.customOrderId,
    paymentUrl: billingOrder.paymentUrl, createdAt: billingOrder.createdAt, paidAt: billingOrder.paidAt,
  }).from(billingOrder).where(and(eq(billingOrder.id, orderId), eq(billingOrder.userId, userId))).limit(1);
  if (!row) return null;
  return { ...row, createdAt: row.createdAt.toISOString(), paidAt: row.paidAt?.toISOString() ?? null };
}

export async function createBillingOrder(userId: string, productId: string, provider = "afdian", idempotencyKey: string = randomUUID()) {
  const product = billingProduct(productId);
  if (!product || (product.id === "points_1_test" && !billingTestProductEnabled())) throw new BillingError("invalid_product", "积分产品不存在。");
  if (provider !== "afdian") throw new Error("当前原型仅支持爱发电测试支付。");

  const [existing] = await getDatabase().select().from(billingOrder).where(and(eq(billingOrder.userId, userId), eq(billingOrder.idempotencyKey, idempotencyKey))).limit(1);
  if (existing) {
    if (existing.productId !== productId || existing.provider !== provider) throw new BillingError("order_not_payable", "同一请求编号不能用于不同商品。");
    return { orderId: existing.id, customOrderId: existing.customOrderId, paymentUrl: existing.paymentUrl, product };
  }

  const base = afdianCheckoutUrl(product.id);
  if (!base) throw new BillingError("checkout_unavailable", "该档位尚未配置独立的爱发电支付链接，请稍后再试。");

  const id = randomUUID();
  const customOrderId = `riic-${id.replaceAll("-", "").slice(0, 24)}`;
  const checkout = new URL(base);
  checkout.searchParams.set("custom_order_id", customOrderId);
  checkout.searchParams.set("product_id", product.id);
  const paymentUrl = checkout.toString();
  const [order] = await getDatabase().insert(billingOrder).values({
    id,
    userId,
    productId: product.id,
    provider,
    amountFen: product.amountFen,
    points: product.points,
    customOrderId,
    idempotencyKey,
    paymentUrl,
  }).returning();
  return { orderId: order.id, customOrderId, paymentUrl, product };
}

/** 订单成功回调与本地模拟支付共用；重复回调只返回当前钱包，不重复发放。 */
export async function fulfillBillingOrder(input: { orderId?: string; customOrderId?: string; providerOrderId?: string; userId?: string; amountFen?: number }) {
  const db = getDatabase();
  return db.transaction(async (tx) => {
    const orderCondition = input.orderId
      ? eq(billingOrder.id, input.orderId)
      : input.customOrderId
        ? eq(billingOrder.customOrderId, input.customOrderId)
        : null;
    if (!orderCondition) throw new Error("缺少订单号。");
    const [order] = await tx.select().from(billingOrder)
      .where(input.userId ? and(orderCondition, eq(billingOrder.userId, input.userId)) : orderCondition)
      .for("update")
      .limit(1);
    if (!order) throw new Error("订单不存在。");
    await ensureWallet(tx, order.userId);
    let wallet = await lockWallet(tx, order.userId);
    wallet = await expireWalletIfNeeded(tx, order.userId, wallet);
    if (order.status === "paid") return { order, wallet: viewWallet(wallet), idempotent: true };
    if (order.status !== "pending") throw new BillingError("order_not_payable", "订单当前状态不可发放积分。");

    const product = billingProduct(order.productId);
    if (!product) throw new BillingError("invalid_product", "订单绑定的积分产品不存在。");
    if (input.amountFen === undefined) {
      throw new BillingError("order_not_payable", "支付回调缺少实付金额，暂不入账。");
    }
    if (input.amountFen !== order.amountFen) {
      throw new BillingError("order_not_payable", "支付金额与订单商品不一致，暂不入账。");
    }
    const next = product.kind === "monthly"
      ? { ...wallet, monthlyPoints: wallet.monthlyPoints + product.points, monthlyExpiresAt: new Date(Date.now() + (product.durationDays ?? 30) * 86_400_000) }
      : { ...wallet, paidPoints: wallet.paidPoints + product.points };
    await tx.update(billingWallet).set({
      paidPoints: next.paidPoints,
      monthlyPoints: next.monthlyPoints,
      monthlyExpiresAt: next.monthlyExpiresAt,
      updatedAt: new Date(),
    }).where(eq(billingWallet.userId, order.userId));
    await tx.insert(billingLedger).values({
      id: randomUUID(), userId: order.userId, kind: product.kind === "monthly" ? "monthly_grant" : "topup",
      pointsDelta: product.points, paidPointsAfter: next.paidPoints, monthlyPointsAfter: next.monthlyPoints,
      referenceType: "billing_order", referenceId: order.id, idempotencyKey: `order:${order.id}`,
      metadata: { productId: product.id, providerOrderId: input.providerOrderId ?? null },
    }).onConflictDoNothing({ target: billingLedger.idempotencyKey });
    const now = new Date();
    const [updated] = await tx.update(billingOrder).set({ status: "paid", providerOrderId: input.providerOrderId ?? order.providerOrderId, paidAt: now, updatedAt: now }).where(eq(billingOrder.id, order.id)).returning();
    return { order: updated, wallet: viewWallet(next), idempotent: false };
  });
}

export async function chargeAgentTool(input: { userId: string; toolName: string; points: number; idempotencyKey: string; runId?: string }) {
  const { userId, toolName, points, idempotencyKey, runId } = input;
  if (points <= 0) return { charged: 0, wallet: await getWallet(userId), usageId: null };
  const db = getDatabase();
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(billingLedger).where(eq(billingLedger.idempotencyKey, idempotencyKey)).limit(1);
    if (existing) {
      await ensureWallet(tx, userId);
      const current = await lockWallet(tx, userId);
      return { charged: Math.abs(existing.pointsDelta), wallet: viewWallet(await expireWalletIfNeeded(tx, userId, current)), usageId: existing.referenceId };
    }
    await ensureWallet(tx, userId);
    let wallet = await lockWallet(tx, userId);
    wallet = await expireWalletIfNeeded(tx, userId, wallet);
    const [committed] = await tx.select().from(billingLedger).where(eq(billingLedger.idempotencyKey, idempotencyKey)).limit(1);
    if (committed) return { charged: Math.abs(committed.pointsDelta), wallet: viewWallet(wallet), usageId: committed.referenceId };
    if (viewWallet(wallet).totalPoints < points) throw new BillingError("insufficient_points", `积分不足，本次${toolName}需要 ${points} 积分。`);
    const monthlyUsed = Math.min(Math.max(0, viewWallet(wallet).monthlyPoints - (wallet.heldMonthlyPoints ?? 0)), points);
    const next = { ...wallet, monthlyPoints: wallet.monthlyPoints - monthlyUsed, paidPoints: wallet.paidPoints - (points - monthlyUsed) };
    await tx.update(billingWallet).set({ paidPoints: next.paidPoints, monthlyPoints: next.monthlyPoints, updatedAt: new Date() }).where(eq(billingWallet.userId, userId));
    const usageId = randomUUID();
    await tx.insert(billingLedger).values({
      id: randomUUID(), userId, kind: "tool_charge", pointsDelta: -points,
      paidPointsAfter: next.paidPoints, monthlyPointsAfter: next.monthlyPoints,
      referenceType: "agent_usage", referenceId: usageId, idempotencyKey,
      metadata: { toolName, runId: runId ?? null },
    });
    await tx.insert(agentUsage).values({
      id: usageId, userId, runId: runId ?? null, toolName, status: "reserved", points,
      idempotencyKey,
      chargedCostRmbFen: Math.ceil(points * 10),
      metadata: {
        billingVersion: 2,
        reservation: { monthlyPoints: monthlyUsed, paidPoints: points - monthlyUsed },
      },
    });
    return { charged: points, wallet: viewWallet(next), usageId };
  });
}

/** Creates a usage record for a pure conversation. It has no fixed tool fee;
 * the finalizer adds only the measured token charge after the model returns. */
export async function createAgentUsage(input: { userId: string; toolName: string; idempotencyKey: string; runId?: string }) {
  const db = getDatabase();
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: agentUsage.id })
      .from(agentUsage)
      .where(eq(agentUsage.idempotencyKey, input.idempotencyKey))
      .limit(1);
    if (existing) return existing.id;
    const id = randomUUID();
    await tx.insert(agentUsage).values({
      id,
      userId: input.userId,
      runId: input.runId ?? null,
      toolName: input.toolName,
      status: "reserved",
      points: 0,
      idempotencyKey: input.idempotencyKey,
      chargedCostRmbFen: 0,
      metadata: { billingVersion: 3, reservation: { toolPoints: 0 } },
    });
    return id;
  });
}

export async function listUsage(userId: string, limit = 40) {
  const rows = await getDatabase().select({
    id: agentUsage.id, toolName: agentUsage.toolName, status: agentUsage.status, points: agentUsage.points,
    inputTokens: agentUsage.inputTokens, outputTokens: agentUsage.outputTokens, cachedInputTokens: agentUsage.cachedInputTokens,
    upstreamCostRmbFen: agentUsage.upstreamCostRmbFen, chargedCostRmbFen: agentUsage.chargedCostRmbFen,
    metadata: agentUsage.metadata, createdAt: agentUsage.createdAt,
  }).from(agentUsage).where(eq(agentUsage.userId, userId)).orderBy(desc(agentUsage.createdAt)).limit(Math.max(1, Math.min(limit, 100)));
  return rows.map((row) => {
    const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {};
    const settlement = metadata.settlement && typeof metadata.settlement === "object" ? metadata.settlement as Record<string, unknown> : {};
    return {
      ...row,
      toolFeePoints: Number.isFinite(Number(settlement.toolPoints)) ? Number(settlement.toolPoints) : (row.toolName === "solve_schedule" ? 1 : 0),
      tokenPoints: Number.isFinite(Number(settlement.tokenPoints)) ? Number(settlement.tokenPoints) : null,
      createdAt: row.createdAt.toISOString(),
      upstreamCostRmb: row.upstreamCostRmbFen == null ? null : row.upstreamCostRmbFen / 100,
      chargedCostRmb: row.chargedCostRmbFen == null ? null : row.chargedCostRmbFen / 100,
    };
  });
}

export async function finalizeAgentUsage(input: {
  usageId: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  upstreamCostRmbFen?: number | null;
  chargedCostRmbFen?: number | null;
  chargedPoints?: number;
  metadata?: Record<string, unknown>;
}) {
  const db = getDatabase();
  return db.transaction(async (tx) => {
    const [usage] = await tx.select().from(agentUsage)
      .where(eq(agentUsage.id, input.usageId))
      .for("update")
      .limit(1);
    if (!usage) return null;
    if (usage.status === "completed" || usage.status === "completed_unsettled") return usage.id;

    await ensureWallet(tx, usage.userId);
    let wallet = await lockWallet(tx, usage.userId);
    wallet = await expireWalletIfNeeded(tx, usage.userId, wallet);

    // Tool usage already contains its fixed fee (solve_schedule: 1 point).
    // Token points are additional and are never used to refund that tool fee.
    const toolPoints = Math.max(0, usage.points);
    const tokenPoints = Math.max(0, Math.ceil(input.chargedPoints ?? 0));
    const available = viewWallet(wallet).totalPoints;
    const settledTokenPoints = Math.min(tokenPoints, available);
    const unsettledPoints = tokenPoints - settledTokenPoints;
    let next = { ...wallet };

    const monthlyUsed = Math.min(Math.max(0, viewWallet(next).monthlyPoints - (next.heldMonthlyPoints ?? 0)), settledTokenPoints);
    next = { ...next, monthlyPoints: next.monthlyPoints - monthlyUsed, paidPoints: next.paidPoints - (settledTokenPoints - monthlyUsed) };

    if (settledTokenPoints > 0) {
      await tx.update(billingWallet).set({
        paidPoints: next.paidPoints,
        monthlyPoints: next.monthlyPoints,
        updatedAt: new Date(),
      }).where(eq(billingWallet.userId, usage.userId));
      await tx.insert(billingLedger).values({
        id: randomUUID(),
        userId: usage.userId,
        kind: "token_settlement",
        pointsDelta: -settledTokenPoints,
        paidPointsAfter: next.paidPoints,
        monthlyPointsAfter: next.monthlyPoints,
        referenceType: "agent_usage",
        referenceId: usage.id,
        idempotencyKey: `agent_usage:settlement:${usage.id}`,
        metadata: { toolPoints, tokenPoints, settledTokenPoints, unsettledPoints },
      }).onConflictDoNothing({ target: billingLedger.idempotencyKey });
    }

    const metadata: Record<string, unknown> = {
      ...input.metadata,
      settlement: {
        toolPoints,
        tokenPoints,
        settledTokenPoints,
        settledPoints: toolPoints + settledTokenPoints,
        unsettledPoints,
        chargedCostRmbFen: input.chargedCostRmbFen ?? null,
      },
    };
    const [row] = await tx.update(agentUsage).set({
      status: unsettledPoints > 0 ? "completed_unsettled" : "completed",
      points: toolPoints + settledTokenPoints,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      cachedInputTokens: input.cachedInputTokens ?? null,
      upstreamCostRmbFen: input.upstreamCostRmbFen ?? null,
      chargedCostRmbFen: input.chargedCostRmbFen ?? usage.chargedCostRmbFen,
      metadata,
      finalizedAt: new Date(),
    }).where(eq(agentUsage.id, usage.id)).returning({ id: agentUsage.id });
    return row?.id ?? null;
  });
}

export async function issueGiftCdk(userId: string, points: number) {
  if (points !== 50 && points !== 110) throw new BillingError("invalid_cdk", "目前只可生成 50 或 110 积分赠送码。");
  const code = randomCdk();
  const cdkId = randomUUID();
  const db = getDatabase();
  const wallet = await db.transaction(async (tx) => {
    await ensureWallet(tx, userId);
    const current = await expireWalletIfNeeded(tx, userId, await lockWallet(tx, userId));
    if (current.paidPoints - (current.heldPaidPoints ?? 0) < points) throw new BillingError("insufficient_points", "赠送码只能使用可用永久积分生成，当前永久积分不足。");
    const paidPoints = current.paidPoints - points;
    await tx.update(billingWallet).set({ paidPoints, updatedAt: new Date() }).where(eq(billingWallet.userId, userId));
    await tx.insert(billingCdk).values({ id: cdkId, codeHash: hashCdk(code), issuerUserId: userId, points });
    await tx.insert(billingLedger).values({
      id: randomUUID(), userId, kind: "cdk_issue", pointsDelta: -points,
      paidPointsAfter: paidPoints, monthlyPointsAfter: current.monthlyPoints,
      referenceType: "billing_cdk", referenceId: cdkId, idempotencyKey: `cdk:issue:${cdkId}`,
    });
    return viewWallet({ ...current, paidPoints });
  });
  return { code, points, wallet, note: "兑换码只显示这一次，请自行保存并交给接收者。" };
}

export async function redeemGiftCdk(userId: string, code: string) {
  if (!validCdk(code)) throw new BillingError("invalid_cdk", "兑换码格式无效。");
  const db = getDatabase();
  return db.transaction(async (tx) => {
    const [cdk] = await tx.select().from(billingCdk).where(eq(billingCdk.codeHash, hashCdk(code))).for("update").limit(1);
    if (!cdk) throw new BillingError("invalid_cdk", "兑换码不存在，请检查后重试。");
    // Use the database clock after acquiring the row lock, so delayed requests
    // and application-host clock skew cannot redeem an expired code.
    const clock = await tx.execute<{ now: Date }>(sql`select clock_timestamp() as now`);
    const now = new Date(clock.rows[0].now);
    const availability = cdkAvailability(cdk, now);
    if (availability === "revoked") throw new BillingError("invalid_cdk", "兑换码已作废，请联系发放方。");
    if (availability === "redeemed") throw new BillingError("invalid_cdk", "兑换码已被使用，不能重复兑换。");
    if (availability === "expired") throw new BillingError("invalid_cdk", "兑换码已过期，请联系发放方。");
    if (availability === "scheduled") throw new BillingError("invalid_cdk", "兑换码尚未到启用时间，请稍后再试。");
    if (availability !== "issued") throw new BillingError("invalid_cdk", "兑换码当前不可用。");
    await ensureWallet(tx, userId);
    const current = await expireWalletIfNeeded(tx, userId, await lockWallet(tx, userId));
    const paidPoints = current.paidPoints + cdk.points;
    await tx.update(billingWallet).set({ paidPoints, updatedAt: new Date() }).where(eq(billingWallet.userId, userId));
    await tx.update(billingCdk).set({ status: "redeemed", redeemerUserId: userId, redeemedAt: new Date() }).where(eq(billingCdk.id, cdk.id));
    await tx.insert(billingLedger).values({
      id: randomUUID(), userId, kind: "cdk_redeem", pointsDelta: cdk.points,
      paidPointsAfter: paidPoints, monthlyPointsAfter: current.monthlyPoints,
      referenceType: "billing_cdk", referenceId: cdk.id, idempotencyKey: `cdk:redeem:${cdk.id}`,
    });
    return { points: cdk.points, wallet: viewWallet({ ...current, paidPoints }) };
  });
}
