import { count, desc, eq, sql } from "drizzle-orm";
import { getDatabase } from "@/server/db";
import { user, wish } from "@/server/db/schema";
import { PublicApiError } from "@/server/api-contract";

export type WishStatus = "pending" | "approved" | "rejected" | "hidden";

export async function listWishes(status?: WishStatus) {
  return getDatabase().select().from(wish).where(status ? eq(wish.status, status) : undefined).orderBy(desc(wish.createdAt)).limit(100);
}

export async function listPublicWishes() {
  return getDatabase().select({
    id: wish.id, title: wish.title, content: wish.content,
    imageUrls: wish.imageUrls, createdAt: wish.createdAt,
  }).from(wish).where(eq(wish.status, "approved")).orderBy(desc(wish.createdAt)).limit(50);
}

export async function createWish(input: { userId: string; title: string; content: string; imageUrls: string[] }) {
  return getDatabase().transaction(async (tx) => {
    // Serialize submissions by account so concurrent requests cannot exceed the quota.
    await tx.execute(sql`SELECT id FROM ${user} WHERE id = ${input.userId} FOR UPDATE`);
    const [existing] = await tx.select({ total: count() }).from(wish).where(eq(wish.userId, input.userId));
    if ((existing?.total ?? 0) >= 5) throw new PublicApiError("AIC-REQ-1001", { message: "最多提交 5 条许愿。" });
    const [created] = await tx.insert(wish).values({ id: crypto.randomUUID(), ...input }).returning();
    return created;
  });
}

export async function updateWish(id: string, input: { status?: WishStatus; adminNote?: string }) {
  const [updated] = await getDatabase().update(wish).set({ ...input, updatedAt: new Date() }).where(eq(wish.id, id)).returning();
  return updated ?? null;
}
