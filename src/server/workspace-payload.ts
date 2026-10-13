import { validateLayoutJson } from "../layout-validation.ts";
import { assertOperbox } from "../operbox.ts";
import { normalizePersistedPlanData } from "../persistence.ts";
import { effectiveFiammettaSetting } from "../plan-presentation.ts";
import { isRotationProfile } from "../rotation-settings.ts";
import type {
  BaseBlueprint,
  BlueprintRoom,
  CloudWorkspacePutRequest,
  CloudWorkspaceState,
  OperBoxEntry,
  PublicPlanData,
  SavedPlanCalculationContext,
} from "../types.ts";
import { PublicApiError } from "./api-contract.ts";

export type ValidatedWorkspace = {
  state: CloudWorkspaceState;
  operbox: OperBoxEntry[] | null;
  result: PublicPlanData | null;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidWorkspace(message: string): never {
  throw new PublicApiError("AIC-DATA-8003", {
    fieldErrors: [{ path: "workspace", code: "invalid_workspace", message }],
  });
}

function optionalScenarioInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 1_000_000) {
    return invalidWorkspace(`布局场景字段 ${field} 无效。`);
  }
  return Number(value);
}

function sanitizeLayout(value: unknown): BaseBlueprint {
  if (validateLayoutJson(value).length || !isObject(value)) return invalidWorkspace("工作区布局无效。");
  const rawLayout = value as Record<string, unknown> & {
    template: string;
    drone_cap: number;
    scenario: Record<string, unknown>;
    rooms: Array<Record<string, unknown>>;
  };
  if (rawLayout.template.length > 120 || rawLayout.rooms.length > 64) return invalidWorkspace("工作区布局超过大小限制。");
  const rawScenario = rawLayout.scenario;
  const baseWorkforce = rawScenario.base_workforce;
  if (baseWorkforce !== undefined && (
    !Array.isArray(baseWorkforce)
    || baseWorkforce.length > 1_000
    || baseWorkforce.some((item) => typeof item !== "string" || item.length > 80)
  )) return invalidWorkspace("布局场景干员列表无效。");
  const rawInitialGlobal = rawScenario.initial_global;
  if (rawInitialGlobal !== undefined && !isObject(rawInitialGlobal)) return invalidWorkspace("布局初始全局状态无效。");
  const scenario: BaseBlueprint["scenario"] = {};
  const eliteFacilityCount = optionalScenarioInteger(rawScenario.elite_facility_count, "elite_facility_count");
  const suiFacilityCount = optionalScenarioInteger(rawScenario.sui_facility_count, "sui_facility_count");
  const dormOccupantCount = optionalScenarioInteger(rawScenario.dorm_occupant_count, "dorm_occupant_count");
  const monsterCuisine = optionalScenarioInteger(rawInitialGlobal?.monster_cuisine, "initial_global.monster_cuisine");
  if (eliteFacilityCount !== undefined) scenario.elite_facility_count = eliteFacilityCount;
  if (suiFacilityCount !== undefined) scenario.sui_facility_count = suiFacilityCount;
  if (dormOccupantCount !== undefined) scenario.dorm_occupant_count = dormOccupantCount;
  if (baseWorkforce !== undefined) scenario.base_workforce = [...baseWorkforce] as string[];
  if (monsterCuisine !== undefined) scenario.initial_global = { monster_cuisine: monsterCuisine };

  const rooms = rawLayout.rooms.map((raw): BlueprintRoom => {
    if (String(raw.id).length > 120) return invalidWorkspace("房间 ID 超过大小限制。");
    const room: BlueprintRoom = {
      id: String(raw.id),
      kind: raw.kind as BlueprintRoom["kind"],
      level: Number(raw.level),
    };
    if (room.kind === "trade_post") {
      room.product = { trade: { order: ((raw.product as { trade: { order: "gold" | "originium" } }).trade.order) } };
    } else if (room.kind === "factory") {
      room.product = { factory: { recipe: ((raw.product as { factory: { recipe: "all" | "gold" | "battle_record" | "originium" } }).factory.recipe) } };
    }
    if (room.kind === "dormitory" && raw.dorm_beds !== undefined) room.dorm_beds = Number(raw.dorm_beds);
    return room;
  });
  return { template: rawLayout.template, drone_cap: Number(rawLayout.drone_cap), scenario, rooms };
}

export function validateWorkspaceState(value: unknown): CloudWorkspaceState {
  if (!isObject(value)) return invalidWorkspace("工作区状态必须是对象。");
  const layout = sanitizeLayout(value.layout);
  const localLayoutBackup = value.localLayoutBackup === null ? null : sanitizeLayout(value.localLayoutBackup);
  if (!["maa", "sample", "skland"].includes(String(value.boxSource))) return invalidWorkspace("Box 来源无效。");
  if (!["local", "skland"].includes(String(value.layoutSource))) return invalidWorkspace("布局来源无效。");
  if (!isRotationProfile(value.rotationProfile)) return invalidWorkspace("换班方式无效。");
  if (typeof value.presetLabel !== "string" || value.presetLabel.length > 120) return invalidWorkspace("布局名称无效。");
  if (value.sourceName !== null && (typeof value.sourceName !== "string" || value.sourceName.length > 80)) {
    return invalidWorkspace("数据来源名称无效。");
  }
  if (typeof value.layoutDirty !== "boolean" || typeof value.fiammettaEnabled !== "boolean") {
    return invalidWorkspace("工作区设置无效。");
  }
  if (!Number.isInteger(value.activeShift) || Number(value.activeShift) < 0 || Number(value.activeShift) > 10) {
    return invalidWorkspace("当前班次无效。");
  }
  return {
    presetLabel: value.presetLabel,
    layout,
    sourceName: value.boxSource === "skland" ? null : typeof value.sourceName === "string" ? value.sourceName.trim().slice(0, 80) : null,
    boxSource: value.boxSource as CloudWorkspaceState["boxSource"],
    layoutDirty: value.layoutDirty,
    layoutSource: value.layoutSource as CloudWorkspaceState["layoutSource"],
    localLayoutBackup,
    rotationProfile: value.rotationProfile,
    fiammettaEnabled: value.fiammettaEnabled,
    activeShift: Number(value.activeShift),
  };
}

export function validateSavedPlanCalculationContext(value: unknown): SavedPlanCalculationContext | null {
  if (!isObject(value)) return null;
  try {
    const layout = sanitizeLayout(value.layout);
    delete layout.scenario.base_workforce;
    if (typeof value.presetLabel !== "string" || value.presetLabel.length > 120) return null;
    if (!isRotationProfile(value.rotationProfile) || typeof value.fiammettaEnabled !== "boolean") return null;
    const context = {
      presetLabel: value.presetLabel,
      layout,
      rotationProfile: value.rotationProfile,
      fiammettaEnabled: value.fiammettaEnabled,
    };
    if (new TextEncoder().encode(JSON.stringify(context)).byteLength > 32 * 1024) return null;
    return context;
  } catch {
    return null;
  }
}

export function workspaceMatchesSavedPlanContext(
  state: CloudWorkspaceState,
  context: SavedPlanCalculationContext,
  operbox: OperBoxEntry[] | null,
): boolean {
  const stateContext = validateSavedPlanCalculationContext({
    presetLabel: state.presetLabel,
    layout: state.layout,
    rotationProfile: state.rotationProfile,
    fiammettaEnabled: state.fiammettaEnabled,
  });
  if (!stateContext) return false;
  const effectiveFiammettaEnabled = effectiveFiammettaSetting(
    operbox,
    state.rotationProfile,
    state.fiammettaEnabled,
  );
  return state.rotationProfile === context.rotationProfile
    && effectiveFiammettaEnabled === context.fiammettaEnabled
    && JSON.stringify(stateContext.layout) === JSON.stringify(context.layout);
}

export type ValidatedWorkspacePutRequest =
  | (ValidatedWorkspace & { baseRevision: number })
  | (Extract<CloudWorkspacePutRequest, { restoreRevisionId: string }> & { baseRevision: number });

export function assertWorkspaceRevision(baseRevision: number, currentRevision: number): void {
  if (baseRevision !== currentRevision) throw new PublicApiError("AIC-DATA-8005");
}

export function validateWorkspacePutRequest(value: unknown): ValidatedWorkspacePutRequest {
  if (!isObject(value)) return invalidWorkspace("请求必须是对象。");
  // Legacy clients may create a workspace, but cannot overwrite an existing one.
  const baseRevision = value.baseRevision == null ? 0 : value.baseRevision;
  if (typeof baseRevision !== "number" || !Number.isSafeInteger(baseRevision) || baseRevision < 0) {
    return invalidWorkspace("同步版本无效。");
  }
  if (typeof value.restoreRevisionId === "string") {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value.restoreRevisionId)) {
      return invalidWorkspace("工作区版本 ID 无效。");
    }
    return { restoreRevisionId: value.restoreRevisionId, baseRevision };
  }
  const state = validateWorkspaceState(value.state);
  let operbox: OperBoxEntry[] | null = null;
  if (state.boxSource === "maa") {
    try {
      operbox = assertOperbox(value.operbox);
    } catch (cause) {
      throw new PublicApiError("AIC-DATA-8003", { cause });
    }
    if (operbox.length > 1_000) return invalidWorkspace("MAA Box 超过大小限制。");
  } else if (value.operbox !== null && value.operbox !== undefined) {
    return invalidWorkspace(state.boxSource === "skland" ? "森空岛 Box 禁止写入云端工作区。" : "样例 Box 不需要写入云端工作区。");
  }
  const result = state.boxSource === "skland" || value.result === null || value.result === undefined
    ? null
    : normalizePersistedPlanData(value.result, state.rotationProfile);
  if (state.boxSource !== "skland" && value.result != null && !result) return invalidWorkspace("排班结果无效。");
  return { baseRevision, state, operbox, result };
}
