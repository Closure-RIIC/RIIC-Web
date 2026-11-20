import "@tanstack/react-start/server-only";

import { and, eq, inArray } from "drizzle-orm";
import { PRIVACY_VERSION, TERMS_VERSION } from "@riic/platform/legal-policy";
import { PublicApiError } from "../api-contract";
import { getDatabase, getDatabasePool } from "../db";
import { sklandBinding } from "../db/schema";
import { qualifyReferral } from "../referral/service";
import { emptySklandBindingSummary, summarizeSklandBindings } from "@riic/arknights-domain/skland-binding-state";
import type { SklandBindingSummary } from "@riic/arknights-domain/types";
import { sklandBindingKey, type SklandPolicyConsent } from "./session";

export class SklandBindingConflictError extends Error {
  constructor() {
    super("这个森空岛账号已经绑定到其他网站账号。");
    this.name = "SklandBindingConflictError";
  }
}

export async function bindSklandAccount(websiteUserId: string, sklandUserId: string, consent: SklandPolicyConsent): Promise<SklandBindingSummary> {
  // Recheck at completion: a QR flow may have started under an older policy.
  if (consent?.termsVersion !== TERMS_VERSION || consent?.privacyVersion !== PRIVACY_VERSION) {
    throw new PublicApiError("AIC-AUTH-2005");
  }
  const bindingKey = sklandBindingKey(sklandUserId);
  const client = await getDatabasePool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO skland_binding (binding_key, user_id, created_at, last_authorized_at)
      VALUES ($1, $2, now(), now()) ON CONFLICT (binding_key) DO NOTHING`, [bindingKey, websiteUserId]);
    const result = await client.query<{ user_id: string }>(
      "SELECT user_id FROM skland_binding WHERE binding_key = $1 FOR UPDATE", [bindingKey],
    );
    if (result.rows[0]?.user_id !== websiteUserId) throw new SklandBindingConflictError();
    await client.query("UPDATE skland_binding SET last_authorized_at = now() WHERE binding_key = $1 AND user_id = $2", [bindingKey, websiteUserId]);
    // Authentication ownership, identity history and any reward commit together.
    // Reauthorization safely retries qualification without granting twice.
    await qualifyReferral(websiteUserId, bindingKey, client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return getSklandBindingSummary(websiteUserId);
}

export async function countSklandBindings(websiteUserId: string): Promise<number> {
  return (await getSklandBindingSummary(websiteUserId)).totalCount;
}

export async function getSklandBindingSummary(
  websiteUserId: string,
  now = Date.now(),
): Promise<SklandBindingSummary> {
  const records = await getDatabase()
    .select({ lastAuthorizedAt: sklandBinding.lastAuthorizedAt })
    .from(sklandBinding)
    .where(eq(sklandBinding.userId, websiteUserId));
  return summarizeSklandBindings(records.map((record) => record.lastAuthorizedAt.getTime()), now);
}

export async function sklandBindingSummariesByUserIds(
  userIds: string[],
  now = Date.now(),
): Promise<Map<string, SklandBindingSummary>> {
  if (!userIds.length) return new Map();
  const records = await getDatabase()
    .select({ userId: sklandBinding.userId, lastAuthorizedAt: sklandBinding.lastAuthorizedAt })
    .from(sklandBinding)
    .where(inArray(sklandBinding.userId, userIds));
  const authorizedAtByUser = new Map<string, number[]>();
  for (const record of records) {
    const values = authorizedAtByUser.get(record.userId) ?? [];
    values.push(record.lastAuthorizedAt.getTime());
    authorizedAtByUser.set(record.userId, values);
  }
  return new Map(userIds.map((userId) => [
    userId,
    authorizedAtByUser.has(userId)
      ? summarizeSklandBindings(authorizedAtByUser.get(userId) ?? [], now)
      : emptySklandBindingSummary(),
  ]));
}

export async function removeSklandBindings(websiteUserId: string, sklandUserIds?: string[]): Promise<void> {
  if (sklandUserIds && sklandUserIds.length === 0) return;
  const condition = sklandUserIds
    ? and(
        eq(sklandBinding.userId, websiteUserId),
        inArray(sklandBinding.bindingKey, sklandUserIds.map((userId) => sklandBindingKey(userId))),
      )
    : eq(sklandBinding.userId, websiteUserId);
  await getDatabase().delete(sklandBinding).where(condition);
}
