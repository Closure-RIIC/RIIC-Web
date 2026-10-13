import { count, desc, eq } from "drizzle-orm";
import { getDatabase } from "@/server/db";
import { wish } from "@/server/db/schema";

export type WishStatus = "pending" | "approved" | "rejected" | "hidden";

export async function listWishes(status?: WishStatus) {
  const db = getDatabase();
  return db.select().from(wish).where(status ? eq(wish.status, status) : undefined).orderBy(desc(wish.createdAt));
}

export async function countUserWishes(userId: string) {
  const [result] = await getDatabase().select({ total: count() }).from(wish).where(eq(wish.userId, userId));
  return result?.total ?? 0;
}

export async function createWish(input: { userId: string; title: string; content: string; imageUrls: string[] }) {
  const [created] = await getDatabase().insert(wish).values({ id: crypto.randomUUID(), ...input }).returning();
  return created;
}

export async function updateWish(id: string, input: { status?: WishStatus; adminNote?: string }) {
  const [updated] = await getDatabase().update(wish).set({ ...input, updatedAt: new Date() }).where(eq(wish.id, id)).returning();
  return updated ?? null;
}
