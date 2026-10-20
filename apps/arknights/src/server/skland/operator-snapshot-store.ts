import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { SklandStatusSnapshot } from "../../types.ts";

const snapshotRoot = path.resolve(
  /* turbopackIgnore: true */ process.env.BETA_STORAGE_DIR || path.join(process.cwd(), "server", "storage"),
  "skland-snapshots",
);

export type OperatorSnapshotDocument = {
  version: 1;
  savedAt: string;
  sourceName: string;
  player: { uid: string; nickname: string; channelName: string };
  operatorCount: number;
  contentSha256: string;
  /** 完整干员池，每项含 modules（模组 id/name/level/locked/isDefault）。 */
  operators: SklandStatusSnapshot["operators"];
};

function safePathSegment(value: unknown): string {
  const invalidPathChars = new Set(["<", ">", ":", '"', "/", "\\", "|", "?", "*"]);
  return String(value ?? "")
    .trim()
    .split("")
    .map((char) => (char.charCodeAt(0) < 32 || invalidPathChars.has(char) ? "_" : char))
    .join("")
    .replace(/\s+/g, "_")
    .slice(0, 48);
}

/**
 * 把含模组的干员池快照写入 server/storage/skland-snapshots/。
 *
 * 求解记录（cli-runs/operbox.json）只保留 7 字段干员池，模组在转换时被丢弃；
 * 这里在服务端拿到完整 SklandStatusSnapshot 的源头（扫码完成、凭证导入、会话同步）
 * 原样落盘 operators。同一内容按哈希去重，落盘失败只告警，不阻断登录与同步。
 */
export async function persistOperatorSnapshot(statusSnapshot: SklandStatusSnapshot): Promise<string | null> {
  try {
    const operators = statusSnapshot.operators;
    if (!Array.isArray(operators) || operators.length === 0) return null;
    const contentSha256 = createHash("sha256").update(JSON.stringify(operators)).digest("hex");
    const dedupePrefix = contentSha256.slice(0, 12);
    await mkdir(snapshotRoot, { recursive: true });
    const existing = await readdir(snapshotRoot);
    if (existing.some((name) => name.includes(dedupePrefix))) return null;

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = [
      stamp,
      safePathSegment(statusSnapshot.player?.nickname),
      `${dedupePrefix}.json`,
    ].filter(Boolean).join("_");
    const filePath = path.join(snapshotRoot, fileName);
    const document: OperatorSnapshotDocument = {
      version: 1,
      savedAt: new Date().toISOString(),
      sourceName: statusSnapshot.sourceName,
      player: {
        uid: statusSnapshot.player?.uid ?? "",
        nickname: statusSnapshot.player?.nickname ?? "",
        channelName: statusSnapshot.player?.channelName ?? "",
      },
      operatorCount: operators.length,
      contentSha256,
      operators,
    };
    const temporaryPath = `${filePath}.tmp-${randomUUID()}`;
    try {
      await writeFile(temporaryPath, JSON.stringify(document, null, 2), { encoding: "utf-8", flag: "wx" });
      await rename(temporaryPath, filePath);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
    return filePath;
  } catch (error) {
    console.warn("[skland-snapshots] 干员池快照落盘失败：", error);
    return null;
  }
}
