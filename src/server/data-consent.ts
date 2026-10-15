import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";

import { PRIVACY_VERSION, TERMS_VERSION } from "@/legal-policy";
import type { AccountDataConsentData, AccountDataConsentRequest } from "@/types";
import { PublicApiError } from "./api-contract";
import { isAccountCloudSyncEnabled } from "./business-config";
import { getDatabase } from "./db";
import { policyConsent } from "./db/schema";

export function isCurrentAccountDataConsent(value: unknown): value is AccountDataConsentRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const consent = value as Partial<AccountDataConsentRequest>;
  return consent.termsAccepted === true
    && consent.privacyAccepted === true
    && consent.termsVersion === TERMS_VERSION
    && consent.privacyVersion === PRIVACY_VERSION;
}

function assertCloudAvailable(): void {
  if (!isAccountCloudSyncEnabled()) throw new PublicApiError("AIC-DATA-8002");
}

export async function accountDataConsent(userId: string): Promise<AccountDataConsentData> {
  if (!isAccountCloudSyncEnabled()) {
    return {
      current: false,
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
      acceptedAt: null,
      revokedAt: null,
      cloudSyncEnabled: false,
    };
  }
  const [current] = await getDatabase().select({
    acceptedAt: policyConsent.acceptedAt,
    revokedAt: policyConsent.revokedAt,
  }).from(policyConsent).where(and(
    eq(policyConsent.userId, userId),
    eq(policyConsent.termsVersion, TERMS_VERSION),
    eq(policyConsent.privacyVersion, PRIVACY_VERSION),
  )).orderBy(desc(policyConsent.acceptedAt)).limit(1);
  return {
    current: Boolean(current && !current.revokedAt),
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION,
    acceptedAt: current?.acceptedAt.toISOString() ?? null,
    revokedAt: current?.revokedAt?.toISOString() ?? null,
    cloudSyncEnabled: true,
  };
}

export async function acceptAccountDataConsent(userId: string, value: unknown): Promise<AccountDataConsentData> {
  assertCloudAvailable();
  if (!isCurrentAccountDataConsent(value)) throw new PublicApiError("AIC-DATA-8003");
  const now = new Date();
  await getDatabase().transaction(async (tx) => {
    // Serialize explicit acceptance with revocation and workspace writes so the
    // last completed account action has an unambiguous policy state.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
    await tx.insert(policyConsent).values({
      id: randomUUID(),
      userId,
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
      acceptedAt: now,
      revokedAt: null,
    }).onConflictDoUpdate({
      target: [policyConsent.userId, policyConsent.termsVersion, policyConsent.privacyVersion],
      set: { acceptedAt: now, revokedAt: null },
    });
  });
  return accountDataConsent(userId);
}

export async function requireAccountDataConsent(userId: string): Promise<void> {
  assertCloudAvailable();
  if (!(await accountDataConsent(userId)).current) throw new PublicApiError("AIC-DATA-8001");
}
