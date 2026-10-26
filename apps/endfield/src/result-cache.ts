import { SOLVER_REVISION, type Result, type Workspace } from "@riic/endfield-solver/model.mjs";

export const RESULT_STORAGE_KEY = "riic:endfield:result:v1";

/** Fixed field order keeps equivalent sync responses from invalidating a result. */
export function workspaceKey(workspace: Workspace): string {
  const { options } = workspace;
  return JSON.stringify([
    // 技能节点参与 key：改技能要触发保存/重算，缓存也要失效。
    workspace.operators.map(op => [op.name, op.elite, op.latestSpaceshipSkillNodes ?? null]),
    options.mfg, options.assist, options.budget, options.time, options.priority,
    ["center", "mfg1", "mfg2", "grow", "guest"].map(key => options.levels[key as keyof typeof options.levels]),
    ["晶植", "菌类", "矿物"].map(key => options.grow[key] ?? 0),
    workspace.manual?.map(room => [room.key, room.slots, room.hour, room.a, room.b]) ?? null,
    workspace.rosterSource ?? null,
  ]);
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const numbers = (value: unknown): value is number[] => Array.isArray(value) && value.every(number);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");
const nullableNumber = (value: unknown) => value === null || number(value);
const crew = (value: Record<string, unknown>) => strings(value.a) && strings(value.b) && number(value.hour);
const mood = (value: unknown) => value === null || object(value) && number(value.consumption) && number(value.recovery) && typeof value.stable === "boolean";
const production = (value: unknown) => object(value) && Object.values(value).every(entry => object(entry)
  && Array.isArray(entry.options) && entry.options.every(option => object(option) && typeof option.name === "string" && number(option.units) && number(option.baseHours)
    && (option.coefficient === undefined || number(option.coefficient)) && (option.kind === undefined || typeof option.kind === "string")
    && (option.slots === undefined || number(option.slots)) && (option.label === undefined || typeof option.label === "string")
    && (option.outputCount === undefined || number(option.outputCount)) && (option.input === undefined || typeof option.input === "string")
    && (option.inputCount === undefined || number(option.inputCount))
    && (option.effectiveHours === undefined || number(option.effectiveHours)))
  && (entry.experience === undefined || number(entry.experience)) && (entry.sanity === undefined || number(entry.sanity))
  && (entry.note === undefined || typeof entry.note === "string"));

/** A cache is optional: obsolete or incomplete data must never break rendering. */
function validResult(value: unknown): value is Result {
  if (!object(value) || value.revision !== SOLVER_REVISION || !number(value.elapsedMs)) return false;
  const { status, verification, center, scores, production: output, rooms } = value;
  return object(status) && typeof status.searchComplete === "boolean" && typeof status.stopReason === "string"
    && [status.centersVisited, status.centersTotal, status.nodes].every(number) && strings(status.approximations)
    && Array.isArray(status.gaps) && status.gaps.every(gap => object(gap) && typeof gap.cat === "string" && typeof gap.reason === "string" && (gap.detail === undefined || typeof gap.detail === "string"))
    && object(verification) && verification.ok === true && strings(verification.errors)
    && object(center) && crew(center) && number(center.recoveryA) && number(center.recoveryB)
    && object(scores) && Object.values(scores).every(number) && production(output)
    && Array.isArray(rooms) && rooms.length <= 4 && rooms.every(room =>
      object(room) && typeof room.key === "string" && typeof room.category === "string" && typeof room.single === "boolean"
      && crew(room) && number(room.value) && nullableNumber(room.bonusA) && nullableNumber(room.bonusB)
      && typeof room.converged === "boolean" && number(room.days) && numbers(room.daily)
      && object(room.avgByKind) && Object.values(room.avgByKind).every(number)
      && mood(room.moodA) && mood(room.moodB) && nullableNumber(room.workHours) && nullableNumber(room.restHours)
      && (room.assist === null || object(room.assist) && number(room.assist.points) && typeof room.assist.shift === "string"
        && Array.isArray(room.assist.cycle) && room.assist.cycle.every(strings)));
}

export function encodeResultCache(workspace: Workspace, result: Result | null): string | null {
  return validResult(result) ? JSON.stringify({ version: 1, key: workspaceKey(workspace), result }) : null;
}

export function restoreResultCache(raw: string | null, workspace: Workspace): Result | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return object(value) && value.version === 1 && value.key === workspaceKey(workspace) && validResult(value.result) ? value.result : null;
  } catch {
    return null;
  }
}
