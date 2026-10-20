import dataJson from "./generated/mastery-data.json" with { type: "json" };
import catalogJson from "./generated/arkntools/operator-catalog.json" with { type: "json" };
import type { OperBoxEntry } from "./types.ts";

export type MasteryLevel = 1 | 2 | 3;
type Rule = { kind: "speed"; bonus: number; professions?: number[]; extra?: { stage?: number; branch?: string; bonus: number } }
  | { kind: "environment"; environment: string; cap: number | null }
  | { kind: "halve" | "morale" | "unsupported"; reason?: string };
export type MasteryEnvironment = Record<string, number>;
export const MASTERY_ENVIRONMENTS: Record<string, { label: string; english: string; perPoint: number; max?: number }> = dataJson.environments;
const RULES = dataJson.rules as Record<string, Rule>;
const BRANCHES: Record<string, string> = dataJson.branches;
const CATALOG = new Map(catalogJson.map((operator) => [operator.id, operator]));
const CATALOG_BY_NAME = new Map(catalogJson.map((operator) => [operator.name, operator]));
const BASE_SECONDS = { 1: 8 * 3600, 2: 16 * 3600, 3: 24 * 3600 };
const EPSILON = 1e-7;
export const MASTERY_UNSUPPORTED_TARGET_IDS = ["char_4195_radian", "char_4230_mcnist"] as const;
const MASTERY_UNSUPPORTED_TARGET_ID_SET = new Set<string>(MASTERY_UNSUPPORTED_TARGET_IDS);

export interface MasteryInput {
  operbox: readonly OperBoxEntry[];
  targetId: string;
  current: 0 | 1 | 2;
  target: MasteryLevel;
  controlBonus: boolean;
  bufferMinutes: number;
  environment: MasteryEnvironment;
}
export interface MasteryTrainer {
  id: string;
  name: string;
  bonuses: Record<MasteryLevel, number>;
  halves: boolean;
  skillIds: string[];
}
export interface MasterySegment {
  trainerId: string | null;
  trainerName: string;
  rate: number;
  seconds: number;
  skillIds: string[];
}
export interface MasteryStage {
  level: MasteryLevel;
  discardPreviousHalving: boolean;
  // This trainer MUST start the stage before the first segment's trainer takes over.
  activateWith: { id: string; name: string } | null;
  segments: MasterySegment[];
  seconds: number;
  nextHalvingTrainerId: string | null;
}
export interface MasteryPlan {
  mode: "simple" | "fast";
  stages: MasteryStage[];
  totalSeconds: number;
  switches: number;
}
export interface MasteryResult { simple: MasteryPlan; fast: MasteryPlan; trainerCount: number }

/** Read-only adapter for MAA short IDs and legacy name-only spreadsheet imports. */
export function normalizeMasteryBox(operbox: readonly OperBoxEntry[]): OperBoxEntry[] {
  const unique = new Map<string, OperBoxEntry>();
  for (const operator of operbox) {
    const meta = CATALOG.get(operator.id) ?? CATALOG.get(`char_${operator.id}`) ?? CATALOG_BY_NAME.get(operator.name);
    if (!meta) continue;
    const normalized = { ...operator, id: meta.id, name: meta.name, rarity: meta.rarity };
    const previous = unique.get(meta.id);
    const score = (entry: OperBoxEntry) => Number(entry.own)*10000+entry.elite*100+entry.level;
    if (!previous || score(normalized) > score(previous)) unique.set(meta.id, normalized);
  }
  return [...unique.values()];
}

export function isSupportedMasteryTarget(targetId: string): boolean {
  const operator = CATALOG.get(targetId);
  return !!operator && operator.rarity >= 4 && !MASTERY_UNSUPPORTED_TARGET_ID_SET.has(targetId);
}

export function eligibleMasteryTargets(operbox: readonly OperBoxEntry[]) {
  return normalizeMasteryBox(operbox).filter((operator) => operator.own && operator.elite === 2 && isSupportedMasteryTarget(operator.id));
}


/** Same-prefix refs are upgrades. Different groups (e.g. Ulpian's two skills) coexist. */
export function unlockedMasterySkills(operator: OperBoxEntry): string[] {
  const refs = CATALOG.get(operator.id)?.buildingSkills ?? [];
  const groups = new Map<string, typeof refs[number]>();
  for (const ref of refs) {
    if (!ref.id.startsWith("train_") || !operator.own || operator.elite < ref.elite || (operator.elite === ref.elite && operator.level < ref.level)) continue;
    const group = ref.id.slice(0, ref.id.lastIndexOf("_"));
    const previous = groups.get(group);
    if (!previous || previous.index < ref.index) groups.set(group, ref);
  }
  return Array.from(groups.values(), (ref) => ref.id);
}

export function availableMasteryEnvironments(operbox: readonly OperBoxEntry[], targetId?: string): string[] {
  const keys = new Set<string>();
  for (const operator of normalizeMasteryBox(operbox)) {
    if (operator.id === targetId) continue;
    for (const id of unlockedMasterySkills(operator)) {
      const rule = RULES[id];
      if (rule?.kind === "environment") keys.add(rule.environment);
    }
  }
  return Object.keys(MASTERY_ENVIRONMENTS).filter((key) => keys.has(key));
}

export function masteryTrainers(input: MasteryInput): MasteryTrainer[] {
  const target = CATALOG.get(input.targetId);
  if (!target) return [];
  return normalizeMasteryBox(input.operbox).filter((operator) => operator.own && operator.id !== input.targetId)
    .map((operator) => {
      const skillIds = unlockedMasterySkills(operator);
      const rules = skillIds.map((id) => RULES[id]).filter((rule): rule is Rule => !!rule);
      const bonus = (stage: MasteryLevel) => rules.reduce((sum, rule) => {
        if (rule.kind === "environment") {
          const count = input.environment[rule.environment] ?? 0;
          return sum + Math.min(count, rule.cap ?? count) * MASTERY_ENVIRONMENTS[rule.environment]!.perPoint;
        }
        if (rule.kind !== "speed" || (rule.professions && !rule.professions.includes(target.profession))) return sum;
        const extra = rule.extra;
        const matches = extra && (extra.stage === undefined || extra.stage === stage) && (extra.branch === undefined || extra.branch === BRANCHES[target.id]);
        return sum + rule.bonus + (matches ? extra.bonus : 0);
      }, 0);
      return { id: operator.id, name: operator.name, skillIds, bonuses: { 1: bonus(1), 2: bonus(2), 3: bonus(3) }, halves: rules.some((rule) => rule.kind === "halve") };
    }).sort((a,b) => a.id.localeCompare(b.id, "en"));
}

function validate(input: MasteryInput) {
  if (!isSupportedMasteryTarget(input.targetId)) throw new Error("请选择专精计算器支持的干员。 / Select a supported mastery target.");
  if (![0,1,2].includes(input.current) || ![1,2,3].includes(input.target) || input.target <= input.current) throw new Error("目标专精等级必须高于当前等级。 / Target mastery must exceed current mastery.");
  if (!Number.isFinite(input.bufferMinutes) || input.bufferMinutes < 0 || !Number.isFinite(input.bufferMinutes * 60)) throw new Error("操作余量必须是非负数。 / Invalid time buffer.");
  for (const [key, value] of Object.entries(input.environment)) {
    const config = MASTERY_ENVIRONMENTS[key];
    if (!config || !Number.isInteger(value) || value < 0 || value > (config.max ?? 10000)) throw new Error("环境参数必须在有效范围内。 / Invalid environment value.");
  }
}

type Path = { stages: MasteryStage[]; seconds: number; switches: number; lastId: string | null; carryId: string | null };
function better(a: Path, b: Path | undefined) {
  return !b || a.seconds < b.seconds - EPSILON || (Math.abs(a.seconds - b.seconds) < EPSILON && a.switches < b.switches);
}

/** Dynamic programming across stage boundaries, including the identity of a carried halving. */
export function solveMastery(input: MasteryInput, trainers: readonly MasteryTrainer[], mode: "simple" | "fast"): MasteryPlan {
  const byId = new Map(trainers.map((trainer) => [trainer.id, trainer]));
  const reducers = trainers.filter((trainer) => trainer.halves);
  const requiredSeconds = 5 * 3600 + input.bufferMinutes * 60;
  const rate = (trainer: MasteryTrainer | null, level: MasteryLevel) => 1 + (input.controlBonus ? 0.05 : 0) + (trainer ? 0.05 + trainer.bonuses[level] / 100 : 0);
  const segment = (trainer: MasteryTrainer | null, level: MasteryLevel, seconds: number): MasterySegment => ({
    trainerId: trainer?.id ?? null, trainerName: trainer?.name ?? "", rate: rate(trainer, level), seconds, skillIds: trainer?.skillIds ?? [],
  });
  let paths: Path[] = [{ stages: [], seconds: 0, switches: 0, lastId: null, carryId: null }];
  for (let number = input.current + 1; number <= input.target; number++) {
    const level = number as MasteryLevel;
    const final = level === input.target;
    const next = new Map<string, Path>();
    for (const path of paths) {
      const carry = path.carryId ? byId.get(path.carryId)! : null;
      // Discarding a carry can be useful if its fast rate prevents recharging the next halving.
      for (const useCarry of carry ? [true, false] : [false]) {
        const work = BASE_SECONDS[level] * (useCarry ? 0.5 : 1);
        const activateWith = useCarry ? { id: carry!.id, name: carry!.name } : null;
        const emit = (segments: MasterySegment[]) => {
          const last = segments.at(-1)!;
          const lastTrainer = last.trainerId ? byId.get(last.trainerId) : null;
          const carryId = !final && lastTrainer?.halves && last.seconds + EPSILON >= requiredSeconds ? lastTrainer.id : null;
          const sequence = [...(activateWith ? [activateWith.id] : []), ...segments.map((s) => s.trainerId)];
          let lastId = path.lastId;
          let switches = path.switches;
          // Explicitly remove/reinsert when choosing to discard a primed carry with the same trainer.
          if (carry && !useCarry && sequence[0] === carry.id) { switches += 2; lastId = carry.id; }
          for (const id of sequence) {
            if (lastId !== id && (path.stages.length || lastId !== null)) switches++;
            lastId = id;
          }
          const seconds = segments.reduce((sum, s) => sum + s.seconds, 0);
          const candidate: Path = { stages: [...path.stages, { level, discardPreviousHalving: !!carry && !useCarry, activateWith, segments, seconds, nextHalvingTrainerId: carryId }], seconds: path.seconds + seconds, switches, lastId, carryId };
          const key = `${lastId ?? "empty"}:${carryId ?? "none"}`;
          if (better(candidate, next.get(key))) next.set(key, candidate);
        };
        for (const trainer of [null, ...trainers]) {
          if (useCarry && mode === "simple" && !final && trainer?.id !== carry!.id) continue;
          emit([segment(trainer, level, work / rate(trainer, level))]);
        }
        if (mode === "fast" && !final) {
          for (const reducer of reducers) {
            const remaining = work - requiredSeconds * rate(reducer, level);
            if (remaining <= EPSILON) continue;
            for (const first of [null, ...trainers]) {
              if (first?.id === reducer.id || rate(first, level) <= rate(reducer, level)) continue;
              // Round the hand-off EARLIER to whole seconds, preserving >= requiredSeconds.
              const prefix = Math.floor(remaining / rate(first, level));
              if (prefix <= 0) continue;
              const suffix = (work - prefix * rate(first, level)) / rate(reducer, level);
              emit([segment(first, level, prefix), segment(reducer, level, suffix)]);
            }
          }
        }
      }
    }
    paths = [...next.values()];
  }
  const winner = paths.reduce<Path | undefined>((best, path) => better(path, best) ? path : best, undefined)!;
  return { mode, stages: winner.stages, totalSeconds: winner.seconds, switches: winner.switches };
}

export function calculateMastery(input: MasteryInput): MasteryResult {
  validate(input);
  const trainers = masteryTrainers(input);
  // Only the fastest ordinary trainer for each stage can improve time. Preserve all reducers
  // and tied fastest trainers so switch-count tie breaking remains valid.
  const maxima = [1,2,3].map((level) => Math.max(0, ...trainers.map((t) => t.bonuses[level as MasteryLevel])));
  const relevant = trainers.filter((t) => t.halves || maxima.some((max, i) => t.bonuses[(i+1) as MasteryLevel] === max));
  return { simple: solveMastery(input,relevant,"simple"), fast: solveMastery(input,relevant,"fast"), trainerCount: trainers.filter((t) => t.skillIds.length > 0).length };
}

export function formatMasteryTime(seconds: number): string {
  const rounded = Math.ceil(seconds - EPSILON);
  return `${Math.floor(rounded / 3600)}:${String(Math.floor(rounded / 60) % 60).padStart(2,"0")}:${String(rounded % 60).padStart(2,"0")}`;
}
