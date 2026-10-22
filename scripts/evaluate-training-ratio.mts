import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { trainingCost } from "../apps/arknights/src/inventory-estimates.ts";
import { manualLevelFor } from "@riic/arknights-domain/manual-operbox";

type Operator = { id: string; own: boolean; rarity: number; elite: number; level: number };
type Box = { operators: Operator[]; e2: Operator[] };
type Cost = { lmd: number; exp: number };
type Method = "allMedian" | "allMode" | "developedMedian" | "developedMeanCost" | "shrunkenMeanCost";

const METHODS: Method[] = ["allMedian", "allMode", "developedMedian", "developedMeanCost", "shrunkenMeanCost"];
const RARITIES = [4, 5, 6];
const EVALUATION_LEVEL = 40;
const PRIOR_WEIGHT = 4;
const argv = process.argv.slice(2);
const option = (name: string, fallback: string) => argv[argv.indexOf(name) + 1] && argv.includes(name)
  ? argv[argv.indexOf(name) + 1]! : fallback;
const DEVELOPED_LEVEL = Number(option("--developed-level", "40"));
const folder = path.resolve(option("--boxes", "../3004/boxes"));
const sampleSize = Number(option("--sample", "240"));
const seed = Number(option("--seed", "20260924"));
const rounds = Number(option("--rounds", "5"));
if (!Number.isInteger(sampleSize) || sampleSize < 20 || !Number.isInteger(seed)
  || !Number.isInteger(rounds) || rounds < 1 || !Number.isInteger(DEVELOPED_LEVEL)
  || DEVELOPED_LEVEL < 2 || DEVELOPED_LEVEL > 60) throw new Error("Invalid sample, seed, rounds or developed level");

function random(seedValue: number) {
  let state = seedValue >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function shuffled<T>(values: T[], next: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const choice = Math.floor(next() * (index + 1));
    [result[index], result[choice]] = [result[choice]!, result[index]!];
  }
  return result;
}

function quantile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * fraction)]!;
}

function medianLevel(values: Operator[]): number | null {
  return quantile(values.map((item) => item.level), 0.5);
}

function modeLevel(values: Operator[]): number | null {
  if (!values.length) return null;
  const counts = new Map<number, number>();
  for (const item of values) counts.set(item.level, (counts.get(item.level) ?? 0) + 1);
  return [...counts].sort(([a, ac], [b, bc]) => bc - ac || a - b)[0]![0];
}

const costCache = new Map<string, Cost>();
function cost(item: Pick<Operator, "rarity" | "level">): Cost {
  const key = `${item.rarity}:${item.level}`;
  let value = costCache.get(key);
  if (!value) {
    value = trainingCost(item.rarity, 2, item.level);
    costCache.set(key, value);
  }
  return value;
}

function meanCost(values: Operator[]): Cost {
  const total = values.reduce((sum, item) => {
    const value = cost(item);
    return { lmd: sum.lmd + value.lmd, exp: sum.exp + value.exp };
  }, { lmd: 0, exp: 0 });
  return { lmd: total.lmd / values.length, exp: total.exp / values.length };
}

function priorFor(boxes: Box[]): Map<number, Operator[]> {
  return new Map(RARITIES.map((rarity) => [rarity, boxes.flatMap((box) => box.e2
    .filter((item) => item.rarity === rarity && item.level >= DEVELOPED_LEVEL))]));
}

function targetCost(method: Method, rarity: number, profile: Operator[], priors: Map<number, Operator[]>): Cost {
  const all = profile.filter((item) => item.rarity === rarity);
  const developed = all.filter((item) => item.level >= DEVELOPED_LEVEL);
  const prior = priors.get(rarity)!;
  if (!prior.length) throw new Error(`Missing ${rarity}-star prior`);
  if (method === "shrunkenMeanCost") {
    const personal = developed.length ? meanCost(developed) : { lmd: 0, exp: 0 };
    const general = meanCost(prior);
    return {
      lmd: (personal.lmd * developed.length + general.lmd * PRIOR_WEIGHT) / (developed.length + PRIOR_WEIGHT),
      exp: (personal.exp * developed.length + general.exp * PRIOR_WEIGHT) / (developed.length + PRIOR_WEIGHT),
    };
  }
  if (method === "developedMeanCost") return meanCost(developed.length ? developed : prior);
  const level = method === "allMedian" ? medianLevel(all)
    : method === "allMode" ? modeLevel(all) : medianLevel(developed);
  return cost({ rarity, level: level ?? medianLevel(prior)! });
}

function estimateRatio(method: Method, profile: Operator[], targetRarities: number[], priors: Map<number, Operator[]>): number {
  const counts = new Map<number, number>();
  for (const rarity of targetRarities) counts.set(rarity, (counts.get(rarity) ?? 0) + 1);
  let lmd = 0;
  let exp = 0;
  for (const [rarity, count] of counts) {
    const unit = targetCost(method, rarity, profile, priors);
    lmd += unit.lmd * count;
    exp += unit.exp * count;
  }
  return lmd / exp;
}

function observedRatio(items: Operator[]): number {
  const total = items.reduce((sum, item) => {
    const value = cost(item);
    return { lmd: sum.lmd + value.lmd, exp: sum.exp + value.exp };
  }, { lmd: 0, exp: 0 });
  return total.lmd / total.exp;
}

function summary(values: number[]) {
  return {
    n: values.length,
    mean: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4)),
    p10: quantile(values, 0.1), p50: quantile(values, 0.5), p90: quantile(values, 0.9),
  };
}

const files = (await readdir(folder)).filter((name) => name.endsWith(".json")).sort();
const boxes: Box[] = [];
const signatures = new Set<string>();
let invalidFiles = 0;
let duplicates = 0;
for (const file of files) {
  try {
    const raw = JSON.parse(await readFile(path.join(folder, file), "utf8")) as unknown;
    if (!Array.isArray(raw)) { invalidFiles++; continue; }
    const operators = raw.filter((value): value is Operator => {
      if (!value || typeof value !== "object") return false;
      const item = value as Partial<Operator>;
      return typeof item.id === "string" && item.own === true
        && Number.isInteger(item.rarity) && Number.isInteger(item.elite) && Number.isInteger(item.level)
        && item.rarity! >= 4 && item.rarity! <= 6;
    });
    const signature = createHash("sha256").update(JSON.stringify(operators.map((item) =>
      [item.id, item.elite, item.level]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))).digest("hex");
    if (signatures.has(signature)) { duplicates++; continue; }
    signatures.add(signature);
    const e2 = operators.filter((item) => item.elite === 2 && item.level >= 1
      && item.level <= manualLevelFor(item.rarity, 2));
    boxes.push({ operators, e2 });
  } catch { invalidFiles++; }
}

const chosen = shuffled(boxes, random(seed)).slice(0, sampleSize);
if (chosen.length < sampleSize) throw new Error(`Only ${chosen.length} distinct boxes available`);
const split = Math.floor(chosen.length * 0.8);
const train = chosen.slice(0, split);
const test = chosen.slice(split);
const priors = priorFor(train);
const outcomes = Object.fromEntries(METHODS.map((method) => [method, [] as number[]])) as Record<Method, number[]>;
const signed = Object.fromEntries(METHODS.map((method) => [method, [] as number[]])) as Record<Method, number[]>;
const variation = Object.fromEntries(METHODS.map((method) => [method, [] as number[]])) as Record<Method, number[]>;
const sensitivity = Object.fromEntries(METHODS.map((method) => [method, [] as number[]])) as Record<Method, number[]>;
const extraModule = [] as number[];
const e2OneShare = [] as number[];
const e2OneUpgradeScenario = [] as number[];
let evaluations = 0;

for (let round = 0; round < rounds; round++) {
  for (let index = 0; index < test.length; index++) {
    const box = test[index]!;
    const developed = box.e2.filter((item) => item.level >= EVALUATION_LEVEL);
    if (developed.length < 8) continue;
    const next = random(seed + round * 100_003 + index * 997);
    const holdoutIds = new Set(shuffled(developed.map((item) => item.id), next)
      .slice(0, Math.max(2, Math.floor(developed.length * 0.25))));
    const holdout = developed.filter((item) => holdoutIds.has(item.id));
    const profile = box.e2.filter((item) => !holdoutIds.has(item.id));
    const actual = observedRatio(holdout);
    evaluations++;
    for (const method of METHODS) {
      const predicted = estimateRatio(method, profile, holdout.map((item) => item.rarity), priors);
      outcomes[method].push(Math.abs(predicted - actual));
      signed[method].push(predicted - actual);
    }
  }
}

for (const box of chosen) {
  const profile = box.e2;
  const developed = profile.filter((item) => item.level >= DEVELOPED_LEVEL);
  if (developed.length < 3) continue;
  e2OneShare.push(profile.filter((item) => item.level === 1).length / profile.length);
  const targetRarities = developed.map((item) => item.rarity);
  const synthetic = [...profile];
  for (const rarity of RARITIES) {
    const count = Math.round(profile.filter((item) => item.rarity === rarity).length * 0.5);
    for (let number = 0; number < count; number++) synthetic.push({ id: `synthetic-${rarity}-${number}`, own: true, rarity, elite: 2, level: 1 });
  }
  for (const method of METHODS) {
    const original = estimateRatio(method, profile, targetRarities, priors);
    variation[method].push(original);
    sensitivity[method].push(Math.abs(estimateRatio(method, synthetic, targetRarities, priors) - original));
  }
  const base = estimateRatio("developedMeanCost", profile, targetRarities, priors);
  const totalExp = targetRarities.reduce((sum, rarity) => sum + targetCost("developedMeanCost", rarity, profile, priors).exp, 0);
  const sixCount = targetRarities.filter((rarity) => rarity === 6).length;
  extraModule.push(base + (sixCount * 0.5 * 300_000) / totalExp - base);
  const awaitingLevels = profile.filter((item) => item.level === 1);
  if (awaitingLevels.length) {
    let extraLmd = 0;
    let extraExp = 0;
    for (const item of awaitingLevels) {
      const target = targetCost("developedMeanCost", item.rarity, profile, priors);
      const current = cost(item);
      extraLmd += target.lmd - current.lmd;
      extraExp += target.exp - current.exp;
    }
    if (extraExp > 0) e2OneUpgradeScenario.push(extraLmd / extraExp);
  }
}

const result = {
  input: { folder, files: files.length, distinct: boxes.length, duplicates, invalidFiles,
    seed, sampled: chosen.length, train: train.length, test: test.length, rounds, evaluations,
    moduleData: false, developedLevel: DEVELOPED_LEVEL, evaluationLevel: EVALUATION_LEVEL,
    priorWeight: PRIOR_WEIGHT },
  e2OneShare: summary(e2OneShare),
  methods: Object.fromEntries(METHODS.map((method) => [method, {
    holdoutAbsoluteError: summary(outcomes[method]),
    holdoutBias: summary(signed[method]),
    accountRatio: summary(variation[method]),
    extraE2OneSensitivity: summary(sensitivity[method]),
  }])),
  halfSixStarFullModuleRatioIncrease: summary(extraModule),
  e2OneUpgradeScenarioRatio: summary(e2OneUpgradeScenario),
};
console.log(JSON.stringify(result, null, 2));
