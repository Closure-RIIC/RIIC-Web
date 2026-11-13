import type { MaaJson, MaaPlan } from "@riic/arknights-domain/types";
import { prepareMaaForExport, sanitizeMaaJson } from "@riic/arknights-domain/maa-safety";
import { parseMaaScheduleText, type ManualScheduleDraft } from "./manual-schedule.ts";

type ImportRecord = { original: MaaJson; baseline: MaaJson; sourceIndexes: (number | null)[] };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Keep the original protocol intent beside the projection: the editor has one selected
// operator per position, while MAA can store several candidates or omit an entire room.
export function rememberMaaImport(original: MaaJson, baseline: MaaJson, sourceIndexes: number[]): string {
  // The editor can add an empty shift to meet its minimum count. It has no source
  // plan and must not turn into a new MAA plan unless the user actually edits it.
  const indexes = baseline.plans.map((_, i) => sourceIndexes[i] ?? null);
  return JSON.stringify({ original: sanitizeMaaJson(original), baseline, sourceIndexes: indexes } satisfies ImportRecord);
}

export function readMaaImport(text: string): ImportRecord {
  try {
    const record = JSON.parse(text);
    const original = parseMaaScheduleText(JSON.stringify(record.original));
    const baseline = parseMaaScheduleText(JSON.stringify(record.baseline));
    const indexes: unknown = record.sourceIndexes;
    if (Array.isArray(indexes) && indexes.length === baseline.plans.length
      && indexes.every(i => i === null || (Number.isInteger(i) && i >= 0 && i < original.plans.length))) {
      return { original, baseline, sourceIndexes: indexes };
    }
  } catch { /* Report corrupt history consistently for uploaded work files. */ }
  throw new Error("作业文件中的 MAA 导入记录无效。");
}

function changedFields<T extends object>(original: T | undefined, before: T | undefined, after: T): T {
  const result = { ...original } as T;
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after)] as (keyof T)[]);
  for (const key of keys) {
    if (same(before?.[key], after[key])) continue;
    if (after[key] === undefined) delete result[key];
    else result[key] = structuredClone(after[key]);
  }
  return result;
}

function editedPlan(original: MaaPlan, before: MaaPlan, after: MaaPlan): MaaPlan {
  const result = structuredClone(original);
  for (const kind of Object.keys(after.rooms) as (keyof MaaPlan["rooms"])[]) {
    const originals = original.rooms[kind];
    const previous = before.rooms[kind];
    const next = after.rooms[kind]!;
    if (same(previous, next)) continue;
    // Preserve [] and missing keys unless a change actually reaches that facility.
    const rooms = (originals ?? []).slice(0, next.length).map(room => structuredClone(room));
    next.forEach((room, i) => {
      if (same(previous?.[i], room)) return;
      while (rooms.length < i) rooms.push({ skip: true });
      const edited = changedFields(originals?.[i], previous?.[i], room);
      if ("candidates" in edited && edited.candidates?.length) edited.autofill = false;
      rooms[i] = edited;
    });
    Object.assign(result.rooms, { [kind]: rooms });
  }
  for (const kind of Object.keys(before.rooms) as (keyof MaaPlan["rooms"])[]) {
    if (!(kind in after.rooms)) delete result.rooms[kind];
  }
  if (!same(before.groups, after.groups)) result.groups = after.groups;
  if (!same(before.Fiammetta, after.Fiammetta)) {
    if (after.Fiammetta) result.Fiammetta = changedFields(original.Fiammetta, before.Fiammetta, after.Fiammetta);
    else delete result.Fiammetta;
  }
  if (!same(before.drones, after.drones)) {
    if (after.drones) result.drones = changedFields(original.drones, before.drones, after.drones);
    else delete result.drones;
  }
  return result;
}

export function downloadManualMaa(draft: ManualScheduleDraft, current: MaaJson, strictOrder = true, replacementSort = false): MaaJson {
  if (!draft.maaImport) return prepareMaaForExport(current, strictOrder, replacementSort, true);
  const { original, baseline, sourceIndexes } = readMaaImport(draft.maaImport);
  const projected = current.plans.flatMap((plan, i) =>
    sourceIndexes[i] === null && same(baseline.plans[i], plan) ? [] : [{ plan, index: i }]);
  const edited = projected.map(({ plan, index: i }) => {
    const sourceIndex = sourceIndexes[i];
    const source = typeof sourceIndex === "number" ? original.plans[sourceIndex] : undefined;
    return source && baseline.plans[i] ? editedPlan(source, baseline.plans[i]!, plan) : structuredClone(plan);
  });
  const editedByIndex = new Map(projected.map(({ index }, offset) => [index, edited[offset]!]));
  // Keep the original order, inactive plans, overlapping windows and midnight boundaries
  // whenever all segments of a source plan can still be represented by that one plan.
  const bySource = new Map<number, MaaPlan>();
  const keepTiming = current.plans.length === baseline.plans.length && current.plans.every((plan, i) => {
    const before = baseline.plans[i]!;
    const index = sourceIndexes[i];
    if (index === null) return same(before, plan);
    if (index === undefined) return false;
    const editedPlan = editedByIndex.get(i)!;
    const prior = bySource.get(index);
    if (!same(before.period, plan.period) || before.duration !== plan.duration || (prior && !same(prior, editedPlan))) return false;
    bySource.set(index, editedPlan);
    return true;
  });
  const plans = keepTiming
    ? original.plans.map((plan, i) => bySource.get(i) ?? plan)
    : edited.map((plan, offset) => {
      const currentPlan = projected[offset]!.plan;
      const updated = { ...plan, duration: currentPlan.duration };
      if (currentPlan.period) updated.period = currentPlan.period;
      else delete updated.period;
      return updated;
    });
  const output = sanitizeMaaJson({ ...original, plans });
  if (!keepTiming && original.planTimes !== undefined && plans.length !== original.plans.length) output.planTimes = plans.length;
  return output;
}
