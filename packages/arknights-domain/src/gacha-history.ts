import gachaUpJson from "./generated/gacha-up.json" with { type: "json" };

const GACHA_UP_BY_POOL_ID = gachaUpJson as Record<string, { six: string[]; five: string[]; openTime?: number; endTime?: number }>;

/** Pool schedules use the CN server timezone, independently of the browser timezone. */
export function formatGachaPoolPeriod(openTime?: number, endTime?: number): string | null {
  if (!Number.isSafeInteger(openTime) || !Number.isSafeInteger(endTime) || !openTime || !endTime || openTime < 0 || endTime <= openTime) return null;
  const format = (time: number) => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(time * 1000).replaceAll("-", ".");
  const start = format(openTime);
  const end = format(endTime);
  return `${start} – ${start.slice(0, 4) === end.slice(0, 4) ? end.slice(5) : end}`;
}

export type GachaRecord = {
  id: string;
  category: string;
  poolId: string;
  poolName: string;
  charId: string;
  charName: string;
  stars: number;
  isNew: boolean;
  timestamp: number;
  pos: number;
};

export type GachaHistory = {
  uid: string;
  nickname: string;
  records: GachaRecord[];
  warnings: string[];
  fetchedAt: string;
};

export function parseGachaRecord(raw: unknown, category: string): GachaRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const timestamp = Number(value.gachaTs);
  const pos = Number(value.pos);
  const rarity = Number(value.rarity);
  if (!Number.isSafeInteger(timestamp) || timestamp < 1_500_000_000_000 || timestamp > Date.now() + 86_400_000
    || !Number.isSafeInteger(pos) || pos < 0 || pos > 9 || !Number.isInteger(rarity) || rarity < 0 || rarity > 5) return null;
  const poolId = String(value.poolId ?? "").slice(0, 120);
  const poolName = String(value.poolName ?? category).slice(0, 120);
  const charId = String(value.charId ?? "").slice(0, 120);
  const charName = String(value.charName ?? charId).slice(0, 120);
  if (!poolName || !charName) return null;
  return {
    id: `${category}:${poolId}:${charId || charName}:${timestamp}:${pos}`,
    category, poolId, poolName, charId, charName, stars: rarity + 1,
    isNew: value.isNew === true, timestamp, pos,
  };
}

export function mergeGachaRecords(existing: GachaRecord[], incoming: GachaRecord[]): GachaRecord[] {
  const byId = new Map(existing.map((record) => [record.id, record]));
  for (const record of incoming) byId.set(record.id, record);
  return [...byId.values()].sort((a, b) => b.timestamp - a.timestamp || b.pos - a.pos);
}

export type GachaPoolGroup = {
  key: string;
  name: string;
  category: string;
  records: GachaRecord[];
  sixStars: number;
  latest: number;
  upSixStars: string[];
  upFiveStars: string[];
  period: string | null;
};

export type GachaSixStarInterval = {
  key: string;
  sixStar: GachaRecord | null;
  lowerStars: GachaRecord[];
  drawCount: number;
  hasPreviousSixStar: boolean;
  offBanner: boolean;
  multiSixStarCount: number;
  multiSixStarBatchKey: string | null;
};

/** Group one pool's saved draws by six-star boundaries, newest interval first. */
export function groupGachaSixStarIntervals(records: readonly GachaRecord[]): GachaSixStarInterval[] {
  const ordered = [...records].sort((a, b) => b.timestamp - a.timestamp || b.pos - a.pos);
  const batchKey = (record: GachaRecord) => JSON.stringify([record.category, record.poolId || record.poolName, record.timestamp]);
  const batches = new Map<string, GachaRecord[]>();
  for (const record of records) {
    const key = batchKey(record);
    const batch = batches.get(key) ?? [];
    batch.push(record);
    batches.set(key, batch);
  }
  const multiSixStars = new Map<string, number>();
  for (const [key, batch] of batches) {
    // Require a complete ten-pull, not coincident single pulls or a partial archive.
    if (batch.length !== 10 || new Set(batch.map((record) => record.pos)).size !== 10
      || batch.some((record) => !Number.isInteger(record.pos) || record.pos < 0 || record.pos > 9)) continue;
    const count = batch.filter((record) => record.stars === 6).length;
    if (count >= 2) multiSixStars.set(key, count);
  }
  const intervals: GachaSixStarInterval[] = [];
  let current: GachaSixStarInterval | undefined;
  for (const record of ordered) {
    if (record.stars === 6) {
      if (current) current.hasPreviousSixStar = true;
      const up = GACHA_UP_BY_POOL_ID[record.poolId]?.six;
      current = { key: record.id, sixStar: record, lowerStars: [], drawCount: 1, hasPreviousSixStar: false,
        offBanner: Boolean(up?.length && !up.includes(record.charName)), multiSixStarCount: multiSixStars.get(batchKey(record)) ?? 0,
        multiSixStarBatchKey: multiSixStars.has(batchKey(record)) ? batchKey(record) : null };
      intervals.push(current);
    } else {
      if (!current) {
        current = { key: `pending:${record.id}`, sixStar: null, lowerStars: [], drawCount: 0, hasPreviousSixStar: false, offBanner: false, multiSixStarCount: 0, multiSixStarBatchKey: null };
        intervals.push(current);
      }
      current.lowerStars.push(record);
      current.drawCount += 1;
    }
  }
  return intervals;
}

/** Keep multi-six-star batches together when a page ends inside a ten-pull. */
export function visibleGachaIntervalKeys(intervals: readonly GachaSixStarInterval[], limit: number): Set<string> {
  const selected = intervals.slice(0, Math.max(0, limit));
  const batches = new Set(selected.flatMap((interval) => interval.multiSixStarBatchKey ? [interval.multiSixStarBatchKey] : []));
  const keys = new Set(selected.map((interval) => interval.key));
  for (const interval of intervals) {
    if (interval.multiSixStarBatchKey && batches.has(interval.multiSixStarBatchKey)) keys.add(interval.key);
  }
  return keys;
}

export function groupGachaPools(records: GachaRecord[]): GachaPoolGroup[] {
  const groups = new Map<string, GachaPoolGroup>();
  for (const record of records) {
    const key = `${record.category}:${record.poolId || record.poolName}`;
    let group = groups.get(key);
    if (!group) {
      const up = GACHA_UP_BY_POOL_ID[record.poolId];
      group = { key, name: record.poolName, category: record.category, records: [], sixStars: 0, latest: 0, upSixStars: up?.six ?? [], upFiveStars: up?.five ?? [], period: formatGachaPoolPeriod(up?.openTime, up?.endTime) };
      groups.set(key, group);
    }
    group.records.push(record);
    if (record.stars === 6) group.sixStars += 1;
    group.latest = Math.max(group.latest, record.timestamp);
  }
  return [...groups.values()].sort((a, b) => b.latest - a.latest);
}
