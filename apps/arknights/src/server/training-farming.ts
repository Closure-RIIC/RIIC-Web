import type { FarmingDrop, FarmingSnapshot } from "@/training-farming";

const base = "https://penguin-stats.io/PenguinStats/api/v2";
const cacheMs = 6 * 60 * 60 * 1000;
let snapshot: FarmingSnapshot | undefined;
let refreshAfter = 0;
let pending: Promise<FarmingSnapshot> | undefined;

type Stage = {
  stageId: string;
  stageType: string;
  code: string;
  apCost: number;
  existence?: { CN?: { exist: boolean; openTime?: number; closeTime?: number } };
  dropInfos?: { itemId?: string; dropType: string }[];
};
type Row = { stageId: string; itemId: string; quantity: number; times: number; start?: number; end?: number | null };

async function fetchJson(path: string) {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("Penguin Statistics is unavailable");
  return response.json();
}

async function refresh(): Promise<FarmingSnapshot> {
  const [stages, result]: [Stage[], { matrix: Row[] }] = await Promise.all([
    fetchJson("/stages?server=CN"),
    fetchJson("/result/matrix?server=CN&show_closed_zones=true"),
  ]);
  const now = Date.now();
  const eligible = new Map(stages.filter((stage) => {
    return ["MAIN", "SUB", "ACTIVITY"].includes(stage.stageType) &&
      Number.isSafeInteger(stage.apCost) && stage.apCost > 0;
  }).map((stage) => [stage.stageId, stage]));
  const drops: FarmingSnapshot["drops"] = Object.create(null);
  const baselines: FarmingSnapshot["baselines"] = Object.create(null);
  const rows = new Map<string, Row>();
  for (const row of result.matrix) {
    if (!eligible.has(row.stageId) || !/^\d+$/.test(row.itemId) ||
      (row.start ?? 0) > now || !Number.isSafeInteger(row.times) || row.times < 100 ||
      !Number.isSafeInteger(row.quantity) || row.quantity <= 0) continue;
    const key = row.stageId + ":" + row.itemId;
    const previous = rows.get(key);
    if (!previous || (row.start ?? 0) > (previous.start ?? 0)) rows.set(key, row);
  }
  for (const row of rows.values()) {
    const stage = eligible.get(row.stageId)!;
    const availability = stage.existence?.CN;
    const drop: FarmingDrop = {
      stageId: row.stageId, code: stage.code, sanity: stage.apCost,
      times: row.times, quantity: row.quantity,
      opensAt: availability?.openTime,
      closesAt: row.end == null ? availability?.closeTime : Math.min(row.end, availability?.closeTime ?? row.end),
    };
    if (row.end == null || row.end > now) {
      if (availability?.exist && (stage.stageType !== "ACTIVITY" || availability.openTime !== undefined)) {
        (drops[row.itemId] ??= []).push(drop);
      }
    }
    if (stage.stageType !== "ACTIVITY" || !/^act\d+side_/.test(stage.stageId) || row.times < 1000 ||
      !stage.dropInfos?.some((info) => info.itemId === row.itemId && info.dropType === "NORMAL_DROP")) continue;
    const previous = baselines[row.itemId];
    if (!previous || drop.quantity / drop.times / drop.sanity > previous.quantity / previous.times / previous.sanity) {
      baselines[row.itemId] = drop;
    }
  }
  if (!Object.keys(drops).length) throw new Error("Penguin Statistics returned no usable drops");
  return { fetchedAt: now, drops, baselines };
}

export function trainingFarmingSnapshot() {
  if (snapshot && Date.now() < refreshAfter) return Promise.resolve(snapshot);
  return pending ??= refresh().then((value) => {
    snapshot = value;
    refreshAfter = Date.now() + cacheMs;
    return value;
  }).catch((error: unknown) => {
    if (!snapshot) throw error;
    refreshAfter = Date.now() + 5 * 60 * 1000;
    return snapshot;
  }).finally(() => { pending = undefined; });
}
