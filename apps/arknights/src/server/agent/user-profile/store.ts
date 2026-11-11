import "@tanstack/react-start/server-only";

import { eq, sql } from "drizzle-orm";
import { getDatabase } from "@riic/platform-server/db";
import { agentUserProfile } from "@riic/platform-server/db/schema";
import { emptyUserProfile, normalizeUserProfile, type UserProfile } from "./core.ts";

/** 只读：不存在时返回空画像，不建行。 */
export async function loadUserProfile(userId: string): Promise<UserProfile> {
  const [row] = await getDatabase()
    .select({ profile: agentUserProfile.profile })
    .from(agentUserProfile)
    .where(eq(agentUserProfile.userId, userId))
    .limit(1);
  return row ? normalizeUserProfile(row.profile) : emptyUserProfile();
}

/**
 * 读-改-写在同一事务里完成并锁住该用户的行：一轮对话里模型可能并行发起多次写入，
 * 不加锁会互相覆盖。mutate 返回 changed=false 时不改写画像（行可能已以空画像建出）。
 * 只读场景请用 loadUserProfile，避免为从不写入的用户建行。
 */
export async function updateUserProfile<T>(
  userId: string,
  mutate: (profile: UserProfile) => { changed: boolean; result: T },
): Promise<T> {
  return getDatabase().transaction(async (tx) => {
    // 先确保行存在，才能用 FOR UPDATE 串行化首次写入。
    await tx.insert(agentUserProfile)
      .values({ userId, profile: emptyUserProfile() })
      .onConflictDoNothing({ target: agentUserProfile.userId });
    const [row] = await tx
      .select({ profile: agentUserProfile.profile })
      .from(agentUserProfile)
      .where(eq(agentUserProfile.userId, userId))
      .for("update")
      .limit(1);
    const profile = normalizeUserProfile(row?.profile);
    const { changed, result } = mutate(profile);
    if (changed) {
      await tx.update(agentUserProfile)
        .set({ profile, updatedAt: sql`now()` })
        .where(eq(agentUserProfile.userId, userId));
    }
    return result;
  });
}
