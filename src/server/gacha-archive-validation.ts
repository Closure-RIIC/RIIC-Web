import { parseGachaRecord, type GachaRecord } from "../gacha-history.ts";

// A pull keeps its identity even if a later official response corrects its name.
export function gachaDrawKey(record: GachaRecord): string {
  return `${record.category}:${record.timestamp}:${record.pos}`;
}

export function validateGachaImport(value: unknown, uid: string): GachaRecord[] {
  if (!value || typeof value !== "object") throw new Error("寻访历史格式无效。");
  const history = value as Record<string, unknown>;
  if (history.uid !== uid || !Array.isArray(history.records) || history.records.length > 50_000) {
    throw new Error("寻访历史的角色不匹配或记录数量过多。");
  }
  const records = new Map<string, GachaRecord>();
  for (const raw of history.records) {
    if (!raw || typeof raw !== "object") throw new Error("寻访记录格式无效。");
    const record = raw as Record<string, unknown>;
    if (typeof record.category !== "string" || !/^[a-zA-Z0-9_-]{1,99}$/.test(record.category)
      || !["poolId", "poolName", "charId", "charName"].every((key) => typeof record[key] === "string" && (record[key] as string).length <= 120)
      || typeof record.timestamp !== "number" || typeof record.pos !== "number"
      || typeof record.stars !== "number" || typeof record.isNew !== "boolean") throw new Error("寻访记录格式无效。");
    const parsed = parseGachaRecord({ ...record, gachaTs: record.timestamp, rarity: record.stars - 1 }, record.category);
    if (!parsed) throw new Error("寻访记录包含无效抽数或时间。");
    records.set(gachaDrawKey(parsed), parsed);
  }
  return [...records.values()];
}
