import "@tanstack/react-start/server-only";

import { and, eq, inArray } from "drizzle-orm";
import { getDatabase } from "../db";
import { sklandBinding } from "../db/schema";
import { emptySklandBindingSummary, summarizeSklandBindings } from "@riic/arknights-domain/skland-binding-state";
import type { SklandBindingSummary } from "@riic/arknights-domain/types";
import { sklandBindingKey } from "./session";

export class SklandBindingConflictError extends Error {
  constructor() {
    super("这个森空岛账号已经绑定到其他网站账号。");
    this.name = "SklandBindingConflictError";
  }
}

export async function bindSklandAccount(websiteUserId: string, sklandUserId: string): Promise<SklandBindingSummary> {
  const bindingKey = sklandBindingKey(sklandUserId);
  const now = new Date();
  await getDatabase().insert(sklandBinding).values({
    bindingKey,
    userId: websiteUserId,
    createdAt: now,
    lastAuthorizedAt: now,
  }).onConflictDoNothing({ target: sklandBinding.bindingKey });

  const [record] = await getDatabase()
    .select({ userId: sklandBinding.userId })
    .from(sklandBinding)
    .where(eq(sklandBinding.bindingKey, bindingKey))
    .limit(1);
  if (!record || record.userId !== websiteUserId) throw new SklandBindingConflictError();

  await getDatabase()
    .update(sklandBinding)
    .set({ lastAuthorizedAt: now })
    .where(and(eq(sklandBinding.bindingKey, bindingKey), eq(sklandBinding.userId, websiteUserId)));
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
