import poolData from "./generated/gacha-up.json" with { type: "json" };
import type { GachaRecord } from "./gacha-history.ts";

type PoolMetadata = { six: string[]; five: string[]; ruleType?: string; openTime?: number; endTime?: number };
const metadata = poolData as Record<string, PoolMetadata>;
export type GachaPoolKind = "standard" | "limited" | "classic" | "linkage" | "other";
export const GACHA_POOL_KINDS: { id: GachaPoolKind; label: string; sharedPity: boolean }[] = [
  { id: "limited", label: "限定寻访", sharedPity: false },
  { id: "standard", label: "标准寻访", sharedPity: true },
  { id: "classic", label: "中坚寻访", sharedPity: true },
  { id: "linkage", label: "联动寻访", sharedPity: false },
  { id: "other", label: "其他寻访", sharedPity: false },
];

export function gachaPoolKind(poolId: string): GachaPoolKind {
  switch (metadata[poolId]?.ruleType) {
    case "NORMAL": case "SINGLE": case "DOUBLE": return "standard";
    case "CLASSIC": case "CLASSIC_DOUBLE": case "FESCLASSIC": return "classic";
    case "LIMITED": return "limited";
    case "LINKAGE": return "linkage";
    default: return "other";
  }
}

export function gachaUpResult(record: GachaRecord): "up" | "off" | "unknown" {
  const up = metadata[record.poolId]?.six;
  if (record.stars !== 6 || !up?.length) return "unknown";
  return up.includes(record.charName) ? "up" : "off";
}

const poolKey = (record: GachaRecord) => `${record.category}:${record.poolId || record.poolName}`;

function sixStarChainKey(record: GachaRecord) {
  const kind = gachaPoolKind(record.poolId);
  return kind === "standard" || kind === "classic" ? kind : poolKey(record);
}

/** Counts always refer to saved records. Unknown UP lists never imply a lost 50/50. */
export function gachaStatistics(records: readonly GachaRecord[]) {
  const ordered = [...records].sort((a, b) => b.timestamp - a.timestamp || b.pos - a.pos);
  const sixStars = ordered.filter((record) => record.stars === 6);
  const upCount = sixStars.filter((record) => gachaUpResult(record) === "up").length;
  const offCount = sixStars.filter((record) => gachaUpResult(record) === "off").length;
  // Walk backwards: only count a draw after encountering its closing six-star / UP.
  // Shared six-star pity can cross banners; UP targets and independent pools cannot.
  const closedSixChains = new Set<string>();
  const closedUpPools = new Set<string>();
  let completedSixDraws = 0;
  let completedUpDraws = 0;
  for (const record of ordered) {
    const chain = sixStarChainKey(record);
    const pool = poolKey(record);
    if (record.stars === 6) closedSixChains.add(chain);
    if (gachaUpResult(record) === "up") closedUpPools.add(pool);
    if (closedSixChains.has(chain)) completedSixDraws++;
    if (closedUpPools.has(pool)) completedUpDraws++;
  }
  const lastSix = ordered.findIndex((record) => record.stars === 6);
  return {
    draws: ordered.length, sixCount: sixStars.length, upCount, offCount,
    unknownSixCount: sixStars.length - upCount - offCount,
    pity: lastSix < 0 ? ordered.length : lastSix,
    pityAtLeast: lastSix < 0 && ordered.length > 0,
    completedSixDraws, completedUpDraws,
    sixAverage: sixStars.length ? completedSixDraws / sixStars.length : null,
    upAverage: upCount ? completedUpDraws / upCount : null,
    offRate: upCount + offCount ? offCount / (upCount + offCount) : null,
  };
}

export type GachaStatistics = ReturnType<typeof gachaStatistics>;

export const GACHA_RATING_TITLES = [
  "究极非酋", "资深非酋", "非酋本酋", "时运不济", "平平无奇",
  "小有欧气", "欧气渐盛", "鸿运当头", "天选欧皇", "至尊欧皇",
] as const;

/** Site-defined reference score and ten-point titles; not a Heybox formula. */
export function gachaLuck(average: number | null) {
  if (average === null || !Number.isFinite(average) || average <= 0) return null;
  const score = Math.max(0, Math.min(100, 100 - average));
  const label = GACHA_RATING_TITLES[Math.min(9, Math.floor(score / 10))];
  const tone = score >= 60 ? "lucky" : score >= 40 ? "normal" : "unlucky";
  return { score, label, tone };
}

/** Chance on the next pull after N failures under the ordinary 2% six-star rule. */
export function nextSixStarProbability(pity: number): number | null {
  if (!Number.isInteger(pity) || pity < 0 || pity > 98) return null;
  return Math.min(100, 2 + Math.max(0, pity - 49) * 2);
}

export type GachaPityTrack = {
  id: string; label: string; count: number | null; atLeast: boolean; probability: number | null; note: string;
};

function achievements(records: readonly GachaRecord[]) {
  const batches = new Map<string, GachaRecord[]>();
  const streaks = new Map<string, number>();
  const limitedDraws = new Map<string, number>();
  let longestUpStreak = 0;
  for (const record of [...records].sort((a, b) => a.timestamp - b.timestamp || a.pos - b.pos)) {
    const key = poolKey(record);
    if (gachaPoolKind(record.poolId) === "limited") limitedDraws.set(key, (limitedDraws.get(key) ?? 0) + 1);
    const batchKey = JSON.stringify([key, record.timestamp]);
    const batch = batches.get(batchKey) ?? [];
    batch.push(record);
    batches.set(batchKey, batch);
    if (record.stars === 6) {
      const count = gachaUpResult(record) === "up" ? (streaks.get(key) ?? 0) + 1 : 0;
      streaks.set(key, count);
      longestUpStreak = Math.max(longestUpStreak, count);
    }
  }
  const multiSix = new Map<number, number>();
  for (const batch of batches.values()) {
    if (batch.length !== 10 || new Set(batch.map((record) => record.pos)).size !== 10
      || batch.some((record) => !Number.isInteger(record.pos) || record.pos < 0 || record.pos > 9)) continue;
    const count = batch.filter((record) => record.stars === 6).length;
    if (count >= 2) multiSix.set(count, (multiSix.get(count) ?? 0) + 1);
  }
  const fullSparks = [...limitedDraws.values()].reduce((sum, count) => sum + Math.floor(count / 300), 0);
  return { multiSix: [...multiSix].sort(([a], [b]) => a - b), longestUpStreak, fullSparks };
}

export function analyzeGachaHistory(records: readonly GachaRecord[], now = Date.now()) {
  const kinds = GACHA_POOL_KINDS.filter((kind) => kind.id !== "linkage").map((kind) => ({
    ...kind,
    ...gachaStatistics(records.filter((record) => {
      const poolKind = gachaPoolKind(record.poolId);
      return poolKind === kind.id || (kind.id === "limited" && poolKind === "linkage");
    })),
  }));
  const byPool = new Map<string, GachaRecord[]>();
  for (const record of records) {
    const key = poolKey(record);
    const pool = byPool.get(key) ?? [];
    pool.push(record);
    byPool.set(key, pool);
  }
  const pools = new Map([...byPool].map(([key, draws]) => {
    const info = metadata[draws[0].poolId];
    return [key, { ...gachaStatistics(draws), kind: gachaPoolKind(draws[0].poolId),
      active: info?.openTime !== undefined && info?.endTime !== undefined
        ? info.openTime * 1000 <= now && now < info.endTime * 1000 : null }];
  }));
  const pityTracks: GachaPityTrack[] = [];
  const activeLimited = Object.entries(metadata).filter(([, info]) => (info.ruleType === "LIMITED" || info.ruleType === "LINKAGE")
    && info.openTime !== undefined && info.endTime !== undefined && info.openTime * 1000 <= now && now < info.endTime * 1000);
  if (!activeLimited.length) pityTracks.push({ id: "limited", label: "限定已垫", count: null, atLeast: false, probability: null, note: "暂无进行中的限定池" });
  for (const [id] of activeLimited) {
    const draws = records.filter((record) => record.poolId === id);
    const stats = gachaStatistics(draws);
    pityTracks.push({ id, label: activeLimited.length > 1 ? draws[0]?.poolName ?? id : "限定已垫",
      count: draws.length ? stats.pity : null, atLeast: stats.pityAtLeast,
      probability: draws.length ? nextSixStarProbability(stats.pity) : null,
      note: draws.length ? "本期独立累计" : "未保存本期记录" });
  }
  for (const id of ["standard", "classic"]) {
    const stats = kinds.find((kind) => kind.id === id)!;
    pityTracks.push({ id, label: id === "standard" ? "标准已垫" : "中坚已垫", count: stats.draws ? stats.pity : null,
      atLeast: stats.pityAtLeast, probability: stats.draws ? nextSixStarProbability(stats.pity) : null,
      note: stats.draws ? "同类卡池共享" : "未保存记录" });
  }
  const currentRecords = records.filter((record) => pools.get(poolKey(record))?.active === true);
  return { career: gachaStatistics(records), current: gachaStatistics(currentRecords), kinds, pools, pityTracks,
    achievements: achievements(records), startedAt: records.length ? records.reduce((earliest, record) => Math.min(earliest, record.timestamp), Infinity) : null };
}
