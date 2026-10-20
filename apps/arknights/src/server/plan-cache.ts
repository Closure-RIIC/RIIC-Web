import { randomUUID } from "node:crypto";

import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { PRIVACY_VERSION, TERMS_VERSION } from "@/legal-policy";
import { normalizePersistedPlanData } from "@/persistence";
import type { BaseBlueprint, OperBoxEntry, PublicPlanData, SolverObservation } from "@/types";
import { isBusinessDatabaseEnabled, isPlanCacheEnabled, PLAN_CACHE_TTL_MS, planCacheHmacKey } from "./business-config";
import { getDatabase } from "./db";
import { planCache, planCacheReference, planRun, policyConsent } from "./db/schema";
import { stablePlanCacheHmac } from "./plan-cache-key";
import { normalizeSolverOperbox } from "./plan-solver-input";
import { waitForPlanCache } from "./plan-cache-wait";
import { planCacheLeaseDurationMs } from "./solver-timeout";

export type PlanCacheKeyInput = {
  layout: BaseBlueprint;
  operbox: OperBoxEntry[];
  sourceType: "sample" | "maa" | "skland";
  sourceName: string;
  rotation: string;
  fiammettaEnable: boolean;
  solver: SolverObservation;
};

type CacheLease = { kind: "lease"; keyHmac: string; leaseOwner: string };
type CacheHit = { kind: "hit"; keyHmac: string; result: PublicPlanData; lookupDurationMs: number };
type CacheBypass = { kind: "bypass" };
export type PlanCacheResolution = CacheLease | CacheHit | CacheBypass;

export function createPlanCacheKey(input: PlanCacheKeyInput): string | null {
  if (!isPlanCacheEnabled()) return null;
  // Skland shares only solver results for the same complete input. Ownership is
  // recorded per request; credentials never belong in shared public results.
  const sha = input.solver.solver_executable_sha256;
  const protocol = input.solver.protocol_version;
  const schema = input.solver.plan_schema_version;
  if (!sha || typeof protocol !== "number" || !Number.isInteger(protocol) || typeof schema !== "number" || !Number.isInteger(schema)) return null;
  return stablePlanCacheHmac(planCacheHmacKey(), {
    layout: input.layout,
    operbox: normalizeSolverOperbox(input.operbox),
    sourceType: input.sourceType,
    sourceName: input.sourceName,
    rotation: input.rotation,
    fiammettaEnable: input.fiammettaEnable,
    solverExecutableSha256: sha,
    protocolVersion: protocol,
    planSchemaVersion: schema,
  });
}

function cachedResult(value: unknown, diagnosticId: string, durationMs: number): PublicPlanData | null {
  const normalized = normalizePersistedPlanData(value, "abc_12_6_6");
  return normalized ? { ...normalized, diagnosticId, durationMs } : null;
}

async function readCacheState(keyHmac: string, startedAt: number): Promise<{ hit: CacheHit | null; leased: boolean }> {
  const now = new Date();
  const [row] = await getDatabase().select({ result: planCache.publicResult, leaseExpiresAt: planCache.leaseExpiresAt }).from(planCache).where(and(
    eq(planCache.keyHmac, keyHmac),
    gt(planCache.expiresAt, now),
  )).limit(1);
  if (!row) return { hit: null, leased: false };
  const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
  const result = cachedResult(row.result, randomUUID(), durationMs);
  if (!result) return { hit: null, leased: Boolean(row.leaseExpiresAt && row.leaseExpiresAt > now) };
  void getDatabase().update(planCache).set({
    hitCount: sql`${planCache.hitCount} + 1`,
    updatedAt: now,
  }).where(eq(planCache.keyHmac, keyHmac)).catch(() => undefined);
  return { hit: { kind: "hit", keyHmac, result, lookupDurationMs: durationMs }, leased: false };
}

export async function lookupPlanCache(input: PlanCacheKeyInput): Promise<CacheHit | CacheBypass> {
  const startedAt = performance.now();
  let keyHmac: string | null;
  try { keyHmac = createPlanCacheKey(input); } catch { return { kind: "bypass" }; }
  if (!keyHmac) return { kind: "bypass" };
  try {
    return (await readCacheState(keyHmac, startedAt)).hit ?? { kind: "bypass" };
  } catch {
    return { kind: "bypass" };
  }
}

export async function resolvePlanCache(input: PlanCacheKeyInput): Promise<PlanCacheResolution> {
  const startedAt = performance.now();
  let keyHmac: string | null;
  try { keyHmac = createPlanCacheKey(input); } catch { return { kind: "bypass" }; }
  if (!keyHmac) return { kind: "bypass" };
  try {
    const leaseDuration = planCacheLeaseDurationMs();
    return await waitForPlanCache<CacheHit | CacheLease>({
      read: () => readCacheState(keyHmac, startedAt),
      timeoutMs: leaseDuration + 5_000,
      acquire: async () => {
        const now = new Date();
        const leaseOwner = randomUUID();
        const leaseExpiresAt = new Date(now.getTime() + leaseDuration);
        const acquired = await getDatabase().insert(planCache).values({
          keyHmac,
          solverExecutableSha256: input.solver.solver_executable_sha256!,
          protocolVersion: input.solver.protocol_version!,
          planSchemaVersion: input.solver.plan_schema_version!,
          publicResult: null,
          createdAt: now,
          updatedAt: now,
          expiresAt: new Date(now.getTime() + PLAN_CACHE_TTL_MS),
          hitCount: 0,
          leaseOwner,
          leaseExpiresAt,
        }).onConflictDoUpdate({
          target: planCache.keyHmac,
          set: {
            solverExecutableSha256: input.solver.solver_executable_sha256!,
            protocolVersion: input.solver.protocol_version!,
            planSchemaVersion: input.solver.plan_schema_version!,
            publicResult: null,
            createdAt: now,
            updatedAt: now,
            expiresAt: new Date(now.getTime() + PLAN_CACHE_TTL_MS),
            hitCount: 0,
            leaseOwner,
            leaseExpiresAt,
          },
          setWhere: or(
            lte(planCache.expiresAt, now),
            and(
              isNull(planCache.publicResult),
              or(isNull(planCache.leaseExpiresAt), lte(planCache.leaseExpiresAt, now)),
            ),
          ),
        }).returning({ leaseOwner: planCache.leaseOwner });
        if (acquired[0]?.leaseOwner === leaseOwner) return { kind: "lease", keyHmac, leaseOwner };
        return null;
      },
    }) ?? { kind: "bypass" };
  } catch {
    return { kind: "bypass" };
  }
}

export async function completePlanCache(lease: CacheLease, result: PublicPlanData): Promise<void> {
  const normalized = normalizePersistedPlanData(result, "abc_12_6_6");
  if (!normalized) return releasePlanCacheLease(lease);
  const now = new Date();
  await getDatabase().update(planCache).set({
    publicResult: { ...normalized, diagnosticId: "cache-template", durationMs: 0, debug: undefined },
    updatedAt: now,
    expiresAt: new Date(now.getTime() + PLAN_CACHE_TTL_MS),
    leaseOwner: null,
    leaseExpiresAt: null,
  }).where(and(eq(planCache.keyHmac, lease.keyHmac), eq(planCache.leaseOwner, lease.leaseOwner)));
}

export async function releasePlanCacheLease(lease: CacheLease): Promise<void> {
  await getDatabase().delete(planCache).where(and(
    eq(planCache.keyHmac, lease.keyHmac),
    eq(planCache.leaseOwner, lease.leaseOwner),
    isNull(planCache.publicResult),
  )).catch(() => undefined);
}

export async function recordPlanCacheReferenceBestEffort(input: {
  cacheKeyHmac: string;
  diagnosticId: string;
  userId?: string | null;
}): Promise<boolean> {
  try {
    const userId = input.userId ?? null;
    return await getDatabase().transaction(async (tx) => {
      if (userId) {
        // Revocation takes the same account lock and evicts references inside its
        // transaction, so a late solve cannot recreate a user-owned cache entry.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
        const [consent] = await tx.select({ revokedAt: policyConsent.revokedAt })
          .from(policyConsent)
          .where(and(
            eq(policyConsent.userId, userId),
            eq(policyConsent.termsVersion, TERMS_VERSION),
            eq(policyConsent.privacyVersion, PRIVACY_VERSION),
          ))
          .limit(1);
        if (consent?.revokedAt) return false;
      }
      await tx.insert(planCacheReference).values({
        id: randomUUID(),
        cacheKeyHmac: input.cacheKeyHmac,
        diagnosticId: input.diagnosticId,
        userId,
      }).onConflictDoNothing({ target: [planCacheReference.cacheKeyHmac, planCacheReference.diagnosticId] });
      return true;
    });
  } catch {
    console.error(JSON.stringify({ level: "error", event: "plan_cache_reference_write_failed", diagnosticId: input.diagnosticId }));
    return false;
  }
}

export async function userPlanCacheKeys(userId: string): Promise<string[]> {
  const rows = await getDatabase().selectDistinct({ key: planCacheReference.cacheKeyHmac }).from(planCacheReference).where(eq(planCacheReference.userId, userId));
  return rows.map((row) => row.key);
}

export async function evictPlanCacheKeys(keys: string[]): Promise<void> {
  if (!keys.length) return;
  await getDatabase().delete(planCache).where(inArray(planCache.keyHmac, keys));
}

export async function evictUserPlanCaches(userId: string): Promise<void> {
  await evictPlanCacheKeys(await userPlanCacheKeys(userId));
}

export async function evictSklandPlanCaches(userId: string): Promise<void> {
  if (!isBusinessDatabaseEnabled()) return;
  const rows = await getDatabase().selectDistinct({ key: planCacheReference.cacheKeyHmac })
    .from(planCacheReference)
    .innerJoin(planRun, eq(planRun.diagnosticId, planCacheReference.diagnosticId))
    .where(and(eq(planCacheReference.userId, userId), eq(planRun.sourceType, "skland")));
  // A shared entry is cheap to rebuild; deleting it also removes all references.
  // Do not leave a copy of the deleted account's derived result in the cache.
  await evictPlanCacheKeys(rows.map((row) => row.key));
}
