import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";

import { parseGameReportDays, type GameReportRecord, type GameReportSource } from "@riic/arknights-domain/game-report";
import { getDatabase } from "@riic/platform-server/db";
import { gameReport } from "@riic/platform-server/db/schema";
import { activeSklandAccount, readSklandAccountStore } from "@riic/platform-server/skland/http";

async function reportRoleKey(userId: string): Promise<string> {
  const account = activeSklandAccount(await readSklandAccountStore(userId));
  return account ? JSON.stringify([account.accountId, account.session.selectedUid]) : "local";
}

export async function latestGameReport(userId: string): Promise<GameReportRecord | null> {
  const roleKey = await reportRoleKey(userId);
  const [row] = await getDatabase().select().from(gameReport)
    .where(and(eq(gameReport.userId, userId), eq(gameReport.roleKey, roleKey)))
    .orderBy(desc(gameReport.createdAt), desc(gameReport.id)).limit(1);
  if (!row) return null;
  const days = parseGameReportDays(row.days, false, true);
  if (!days) throw new Error("Stored game report has invalid day data");
  return { id: row.id, sourceType: row.sourceType, days, createdAt: row.createdAt.toISOString() };
}

export async function saveGameReport(userId: string, sourceType: GameReportSource, days: GameReportRecord["days"]): Promise<GameReportRecord> {
  const roleKey = await reportRoleKey(userId);
  const [row] = await getDatabase().insert(gameReport).values({ id: randomUUID(), userId, roleKey, sourceType, days }).returning();
  if (!row) throw new Error("Failed to save game report");
  return { id: row.id, sourceType: row.sourceType, days, createdAt: row.createdAt.toISOString() };
}
