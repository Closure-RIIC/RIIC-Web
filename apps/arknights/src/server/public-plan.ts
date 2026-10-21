import type {
  DebugBundle,
  BaseBlueprint,
  MaaJson,
  PlanApiResponse,
  PublicPlanData,
  RotationJson,
  UserProfile,
} from "../types";
import { stripInternalFields } from "../internal-field-safety.ts";
import { sanitizeMaaJson } from "../maa-safety.ts";
import { DEFAULT_ROTATION_PROFILE } from "../rotation-settings.ts";
import { isDebugToolsEnabled, PublicApiError } from "./api-contract.ts";
import { normalizeRotationResult, rotationFallbackProfile } from "../rotation-result.ts";
import { parseTrainingAdviceReport } from "../training-advice-contract.ts";
import { parseTrainingRoomSchedule } from "../training-room-contract.ts";
import { applyDroneAllocationsToMaa, droneProductionForRotation, equivalentGoldForRotation } from "./drone-production.ts";

const PATH_SEPARATOR = /[/\\]+/g;
const SOLVER_DIAGNOSTIC_FIELDS = new Set([
  "solver",
  "plan_contract_sha256",
  "solver_executable_sha256",
]);

type PublicPlanOptions = {
  includeDebug?: boolean;
};

function safeDuration(value: unknown): number {
  const duration = Number(value);
  return Number.isFinite(duration) ? Math.max(0, duration) : 0;
}

export function safeDisplayName(value: unknown, fallback: string, maxLength = 80): string {
  const normalized = String(value ?? "")
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .replace(PATH_SEPARATOR, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
  return normalized || fallback;
}

function sanitizeProfile(profile: UserProfile, layoutLabel: string, sourceName: string): UserProfile {
  const publicDomains = stripInternalFields(structuredClone(profile.domains));
  return {
    ...stripInternalFields(structuredClone(profile)),
    layout_label: safeDisplayName(layoutLabel, "当前布局"),
    operbox_label: safeDisplayName(sourceName, "已导入的干员数据"),
    baseline_label: "产品推荐基准",
    domains: publicDomains.map((domain) => ({
      ...domain,
      label: safeDisplayName(domain.label, "效率指标", 120),
    })),
  };
}

function stripSolverDiagnostics<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripSolverDiagnostics(item)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SOLVER_DIAGNOSTIC_FIELDS.has(key.toLowerCase()))
        .map(([key, child]) => [key, stripSolverDiagnostics(child)])
    ) as T;
  }
  return value;
}

function sanitizeMaa(maa: MaaJson, layoutLabel: string): MaaJson {
  return {
    ...sanitizeMaaJson(maa),
    title: `可露希尔基建终端 · ${safeDisplayName(layoutLabel, "当前布局")}`,
  };
}

function sanitizePublicDebugBundle(
  debugBundle: DebugBundle | undefined
): Omit<DebugBundle, "solver"> | undefined {
  if (!debugBundle) return undefined;
  return stripSolverDiagnostics(structuredClone(debugBundle)) as Omit<DebugBundle, "solver">;
}

export function toPublicPlanData(
  result: PlanApiResponse,
  input: { layoutLabel: string; sourceName: string; layout?: BaseBlueprint },
  requestId: string,
  options: PublicPlanOptions = {}
): PublicPlanData {
  if (!result.success || !result.profileJson || !result.maaJson || !result.rotationJson) {
    const message = result.error?.toLowerCase() ?? "";
    if (message.includes("timeout") || message.includes("超时")) {
      throw new PublicApiError("AIC-PLAN-3003");
    }
    if (message.includes("没有找到可运行") || message.includes("未找到可运行")) {
      throw new PublicApiError("AIC-PLAN-3001");
    }
    throw new PublicApiError("AIC-PLAN-3004");
  }

  let trainingAdvice: PublicPlanData["trainingAdvice"];
  if (result.trainingAdviceJson !== undefined) {
    try {
      trainingAdvice = parseTrainingAdviceReport(result.trainingAdviceJson);
    } catch (error) {
      throw new PublicApiError("AIC-PLAN-3004", { cause: error });
    }
  }

  let trainingRoom: PublicPlanData["trainingRoom"];
  if (result.trainingRoomJson !== undefined) {
    try {
      trainingRoom = parseTrainingRoomSchedule(result.trainingRoomJson, result.maaJson);
    } catch (error) {
      throw new PublicApiError("AIC-PLAN-3004", { cause: error });
    }
  }

  const normalizedRotation = normalizeRotationResult({
    source: result.rotationJson as RotationJson,
    profile: result.profileJson,
    fallbackProfile: rotationFallbackProfile(result.profileJson, DEFAULT_ROTATION_PROFILE),
  });
  if (input.layout && normalizedRotation.daily.production) {
    normalizedRotation.daily.production.equivalent_gold = equivalentGoldForRotation(normalizedRotation);
    normalizedRotation.daily.drone_production = droneProductionForRotation({
      layout: input.layout,
      maa: result.maaJson,
      rotation: normalizedRotation,
    });
  }
  const maaWithDrones = input.layout
    ? applyDroneAllocationsToMaa({ layout: input.layout, maa: result.maaJson, rotation: normalizedRotation })
    : result.maaJson;
  const data: PublicPlanData = {
    profile: sanitizeProfile(result.profileJson, input.layoutLabel, input.sourceName),
    maa: sanitizeMaa(maaWithDrones, input.layoutLabel),
    ...(trainingRoom ? { trainingRoom } : {}),
    ...(trainingAdvice ? { trainingAdvice } : {}),
    rotation: normalizedRotation,
    durationMs: safeDuration(result.durationMs),
    diagnosticId: result.runId ?? requestId,
  };

  if (options.includeDebug && isDebugToolsEnabled()) {
    data.debug = {
      command: result.command,
      stdout: result.stdout,
      stderr: result.stderr,
      debugBundle: sanitizePublicDebugBundle(result.debugBundle),
    };
  }
  return data;
}
