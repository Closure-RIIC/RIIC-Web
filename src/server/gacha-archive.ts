import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { getDatabase } from "./db/index.ts";
import { gachaArchive, gachaDraw } from "./db/schema.ts";
import { PublicApiError } from "./api-contract";
import { gachaDrawKey } from "./gacha-archive-validation.ts";
import type { GachaHistory } from "../gacha-history.ts";

export async function listGachaArchives(owner: string) {
  return getDatabase().select({ uid: gachaArchive.uid, nickname: gachaArchive.nickname })
    .from(gachaArchive).where(eq(gachaArchive.userId, owner)).orderBy(gachaArchive.createdAt, gachaArchive.uid);
}

export async function readGachaArchive(owner: string, uid: string): Promise<GachaHistory | null> {
  // Read metadata and records in one statement: deletion cannot produce a mixed snapshot.
  const rows = await getDatabase().select({ archive: gachaArchive, record: gachaDraw.record })
    .from(gachaArchive).leftJoin(gachaDraw, eq(gachaArchive.uid, gachaDraw.uid))
    .where(and(eq(gachaArchive.uid, uid), eq(gachaArchive.userId, owner)));
  const archive = rows[0]?.archive;
  if (!archive?.savedAt) return null;
  return { uid, nickname: archive.nickname, warnings: archive.warnings, fetchedAt: archive.savedAt.toISOString(),
    records: rows.flatMap((row) => row.record ? [row.record] : []).sort((a, b) => b.timestamp - a.timestamp || b.pos - a.pos) };
}

/** Call only with a role verified by the upstream authorization, never a client-supplied owner. */
export async function saveGachaArchive(owner: string, history: GachaHistory, source: "official" | "browser") {
  await getDatabase().transaction(async (tx) => {
    await tx.insert(gachaArchive).values({ uid: history.uid, userId: owner, nickname: history.nickname })
      .onConflictDoNothing({ target: gachaArchive.uid });
    const [archive] = await tx.select().from(gachaArchive).where(eq(gachaArchive.uid, history.uid)).for("update");
    if (!archive || archive.userId !== owner) throw new PublicApiError("AIC-AUTH-2006", { message: "该明日方舟角色的寻访档案已绑定其他网站账号，不能转移。" });
    const distinct = [...new Map(history.records.map((record) => [gachaDrawKey(record), record])).values()];
    for (let offset = 0; offset < distinct.length; offset += 500) {
      const insert = tx.insert(gachaDraw).values(distinct.slice(offset, offset + 500).map((record) => ({ uid: history.uid, drawKey: gachaDrawKey(record), record, source })));
      if (source === "official") await insert.onConflictDoUpdate({ target: [gachaDraw.uid, gachaDraw.drawKey], set: { record: sql`excluded.record`, source: "official" } });
      else await insert.onConflictDoNothing({ target: [gachaDraw.uid, gachaDraw.drawKey] });
    }
    await tx.update(gachaArchive).set({ nickname: history.nickname, savedAt: new Date(),
      warnings: source === "official" ? history.warnings : archive.warnings })
      .where(and(eq(gachaArchive.uid, history.uid), eq(gachaArchive.userId, owner)));
  });
  return readGachaArchive(owner, history.uid);
}

export async function clearGachaArchive(owner: string, uid: string) {
  await getDatabase().transaction(async (tx) => {
    const [archive] = await tx.select().from(gachaArchive)
      .where(and(eq(gachaArchive.uid, uid), eq(gachaArchive.userId, owner))).for("update");
    if (!archive) throw new PublicApiError("AIC-REQ-1001");
    await tx.delete(gachaDraw).where(eq(gachaDraw.uid, uid));
    await tx.update(gachaArchive).set({ savedAt: null, warnings: [] }).where(eq(gachaArchive.uid, uid));
  });
}
