import "server-only";

import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { getDatabase } from "@/server/db";
import { billingCdk } from "@/server/db/schema";
import { CdkValidationError, hashCdk, parseAdminCdkInput, parseCdkRevocation, randomCdk } from "./cdk";

/** Grants new promotional points; unlike user gift codes, no wallet is debited. */
export async function issueAdminCdks(issuerUserId: string, value: unknown) {
  const input = parseAdminCdkInput(value);
  const codes = input.codes ?? Array.from({ length: input.count }, randomCdk);
  try {
    // One INSERT is atomic. Stable primary keys also prevent retrying a batch
    // after an ambiguous network response from creating additional grants.
    await getDatabase().insert(billingCdk).values(codes.map((code, index) => ({
      id: `admin:${input.batchId}:${index}`,
      issuerUserId,
      codeHash: hashCdk(code),
      points: input.points,
      batchId: input.batchId,
      ...(input.batchLabel ? { batchLabel: input.batchLabel } : {}),
      ...(input.startsAt ? { startsAt: input.startsAt } : {}),
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    })));
  } catch (error) {
    const cause = error instanceof Error && error.cause ? error.cause : error;
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "23505") {
      throw new CdkValidationError("此批次已生成或兑换码已存在，未新增任何兑换码。请先查看发放记录；明文仅首次成功时返回。");
    }
    throw error;
  }
  return { batchId: input.batchId, batchLabel: input.batchLabel ?? null, startsAt: input.startsAt?.toISOString() ?? null, expiresAt: input.expiresAt?.toISOString() ?? null, points: input.points, codes };
}

// Include operational batches issued before the management UI was deployed.
const batchId = sql<string | null>`coalesce(${billingCdk.batchId}, substring(${billingCdk.id} from '^admin:([0-9a-f-]{36}):[0-9]+$'))`;
const availability = sql<string>`case when ${billingCdk.status} <> 'issued' then ${billingCdk.status}
  when ${billingCdk.expiresAt} <= now() then 'expired'
  when ${billingCdk.startsAt} > now() then 'scheduled' else 'issued' end`;

export async function listAdminCdks(params = new URLSearchParams()) {
  const page = Number(params.get("page") ?? 1);
  const status = params.get("status") ?? "all";
  const query = (params.get("q") ?? "").trim();
  if (!Number.isInteger(page) || page < 1 || page > 10000 || query.length > 100 || !["all", "issued", "scheduled", "expired", "revoked", "redeemed"].includes(status)) throw new CdkValidationError("筛选条件无效。");
  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  const search = query ? or(ilike(billingCdk.batchLabel, pattern), ilike(billingCdk.id, pattern)) : undefined;
  const condition = and(search, status === "all" ? undefined : sql`${availability} = ${status}`);
  const db = getDatabase();
  const [summary] = await db.select({
    total: sql<number>`count(*)::int`,
    available: sql<number>`count(*) filter (where ${availability} = 'issued')::int`,
    redeemed: sql<number>`count(*) filter (where ${availability} = 'redeemed')::int`,
    outstandingPoints: sql<number>`coalesce(sum(${billingCdk.points}) filter (where ${availability} in ('issued', 'scheduled')), 0)::float8`,
  }).from(billingCdk).where(search);
  const [count] = await db.select({ total: sql<number>`count(*)::int` }).from(billingCdk).where(condition);
  const pageSize = 25;
  const pages = Math.max(1, Math.ceil(count.total / pageSize));
  const currentPage = Math.min(page, pages);
  const rows = await db.select({
    id: billingCdk.id, points: billingCdk.points, status: billingCdk.status,
    issuerUserId: billingCdk.issuerUserId, redeemerUserId: billingCdk.redeemerUserId,
    createdAt: billingCdk.createdAt, redeemedAt: billingCdk.redeemedAt,
    batchId, batchLabel: billingCdk.batchLabel, availability,
    startsAt: billingCdk.startsAt, expiresAt: billingCdk.expiresAt,
    revokedAt: billingCdk.revokedAt, revokedBy: billingCdk.revokedBy, revokeReason: billingCdk.revokeReason,
  }).from(billingCdk).where(condition).orderBy(desc(billingCdk.createdAt), desc(billingCdk.id)).limit(pageSize).offset((currentPage - 1) * pageSize);
  return { codes: rows.map(row => ({ ...row, createdAt: row.createdAt.toISOString(), redeemedAt: row.redeemedAt?.toISOString() ?? null,
    startsAt: row.startsAt?.toISOString() ?? null, expiresAt: row.expiresAt?.toISOString() ?? null, revokedAt: row.revokedAt?.toISOString() ?? null,
  })), summary, total: count.total, page: currentPage, pages };
}

export async function revokeAdminCdks(adminId: string, value: unknown) {
  const input = parseCdkRevocation(value);
  const rows = await getDatabase().update(billingCdk).set({ status: "revoked", revokedAt: new Date(), revokedBy: adminId, revokeReason: input.reason })
    .where(and(eq(billingCdk.status, "issued"), input.id ? eq(billingCdk.id, input.id) : eq(batchId, input.batchId!)))
    .returning({ id: billingCdk.id });
  // A concurrent redemption owns the same row lock: either the grant completes
  // first (and this skips it), or revocation commits first and redemption fails.
  return { revoked: rows.length };
}
