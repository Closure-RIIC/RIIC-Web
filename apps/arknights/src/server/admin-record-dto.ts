import type {
  AdminFeedbackFacility,
  AdminFeedbackRecordData,
  AdminFeedbackStatus,
  AdminPlanRunRecordData,
  AdminReproductionData,
  AdminReproductionUnavailableReason,
  AppErrorCode,
  BaseBlueprint,
  BlueprintRoom,
  FeedbackKind,
  FeedbackRoom,
} from "@/types";
import { validateLayoutJson } from "../layout-validation.ts";
import { assertOperbox } from "../operbox.ts";
import { diagnosticText } from "./diagnostic-text.ts";
import { isRotationProfile, rotationShiftCount } from "../rotation-settings.ts";

type UnknownRecord = Record<string, unknown>;

const FACILITIES = new Set<AdminFeedbackFacility>([
  "trading",
  "manufacture",
  "power",
  "control",
  "dormitory",
  "meeting",
  "hire",
  "processing",
  "training",
]);

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && Number.isFinite(new Date(value).getTime())) {
    return new Date(value).toISOString();
  }
  return new Date(0).toISOString();
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function boundedString(value: unknown, maxLength: number): string | null {
  const text = nullableString(value);
  return text ? text.slice(0, maxLength) : null;
}

function reproductionLayout(value: unknown): BaseBlueprint | null {
  if (validateLayoutJson(value).length) return null;
  const layout = record(value)!;
  const rawScenario = record(layout.scenario)!;
  const scenario: BaseBlueprint["scenario"] = {};
  for (const field of ["elite_facility_count", "sui_facility_count", "dorm_occupant_count"] as const) {
    if (typeof rawScenario[field] === "number") scenario[field] = rawScenario[field];
  }
  if (Array.isArray(rawScenario.base_workforce)) {
    scenario.base_workforce = rawScenario.base_workforce.filter((name): name is string => typeof name === "string");
  }
  const rawInitialGlobal = record(rawScenario.initial_global);
  if (typeof rawInitialGlobal?.monster_cuisine === "number") {
    scenario.initial_global = { monster_cuisine: rawInitialGlobal.monster_cuisine };
  }
  const rooms = (layout.rooms as unknown[]).map((value): BlueprintRoom => {
    const raw = record(value)!;
    const room: BlueprintRoom = {
      id: String(raw.id),
      kind: raw.kind as BlueprintRoom["kind"],
      level: Number(raw.level),
    };
    if (room.kind === "trade_post") {
      room.product = { trade: { order: record(record(raw.product)?.trade)?.order as "gold" | "originium" } };
    } else if (room.kind === "factory") {
      room.product = { factory: { recipe: record(record(raw.product)?.factory)?.recipe as "all" | "gold" | "battle_record" | "originium" } };
    }
    if (room.kind === "dormitory" && typeof raw.dorm_beds === "number") room.dorm_beds = raw.dorm_beds;
    return room;
  });
  return {
    template: String(layout.template),
    drone_cap: Number(layout.drone_cap),
    scenario,
    rooms,
  };
}

function reproductionOperbox(value: unknown) {
  try {
    return assertOperbox(value);
  } catch {
    return null;
  }
}

function feedbackRoom(value: unknown): FeedbackRoom | null {
  const room = record(value);
  if (!room || typeof room.id !== "string" || typeof room.title !== "string" || typeof room.group !== "string") {
    return null;
  }
  return {
    id: room.id,
    title: room.title,
    group: room.group,
    operators: Array.isArray(room.operators)
      ? room.operators.filter((entry): entry is string => typeof entry === "string").slice(0, 10)
      : [],
  };
}

export function normalizeAdminFeedbackStatus(value: unknown): AdminFeedbackStatus {
  if (value === "reviewed" || value === "ignored") return value;
  if (value === "reproduced" || value === "working") return "reproduced";
  if (value === "fixed" || value === "resolved") return "fixed";
  return "unreviewed";
}

export function isAdminFeedbackStatus(value: unknown): value is AdminFeedbackStatus {
  return value === "unreviewed" || value === "reproduced" || value === "fixed" || value === "reviewed" || value === "ignored";
}

export function legacyAdminFeedbackStatus(value: unknown): AdminFeedbackStatus | null {
  if (isAdminFeedbackStatus(value)) return value;
  if (value === "pending") return "unreviewed";
  if (value === "working") return "reproduced";
  if (value === "resolved") return "fixed";
  return null;
}

export function feedbackFacility(kind: FeedbackKind, room: FeedbackRoom | null): AdminFeedbackFacility {
  if (kind === "performance_issue") return "solver";
  return room && FACILITIES.has(room.group as AdminFeedbackFacility)
    ? room.group as AdminFeedbackFacility
    : "unknown";
}

export function toAdminFeedbackRecordData(value: UnknownRecord): AdminFeedbackRecordData {
  const kind: FeedbackKind = value.kind === "performance_issue" ? "performance_issue" : "room_issue";
  const room = kind === "room_issue" ? feedbackRoom(value.room) : null;
  return {
    id: String(value.id ?? ""),
    diagnosticId: String(value.diagnosticId ?? ""),
    kind,
    facility: feedbackFacility(kind, room),
    room,
    note: String(value.note ?? ""),
    status: normalizeAdminFeedbackStatus(value.status),
    adminNote: nullableString(value.adminNote),
    hasLinkedRun: typeof value.planRunDiagnosticId === "string" && value.planRunDiagnosticId.length > 0,
    createdAt: iso(value.createdAt),
    updatedAt: iso(value.updatedAt),
    expiresAt: iso(value.expiresAt),
  };
}

export function toAdminPlanRunRecordData(value: UnknownRecord): AdminPlanRunRecordData {
  const sourceType = value.sourceType === "sample" || value.sourceType === "skland" ? value.sourceType : "maa";
  return {
    diagnosticId: String(value.diagnosticId ?? ""),
    sourceType,
    status: value.status === "success" ? "success" : "failed",
    layoutTemplate: String(value.layoutTemplate ?? ""),
    roomCount: Number(value.roomCount ?? 0),
    operatorCount: Number(value.operatorCount ?? 0),
    rotation: String(value.rotation ?? ""),
    fiammettaEnable: value.fiammettaEnable === true,
    durationMs: typeof value.durationMs === "number" && Number.isFinite(value.durationMs) ? value.durationMs : null,
    errorCode: typeof value.errorCode === "string" ? value.errorCode as AppErrorCode : null,
    solverExecutableSha256: nullableString(value.solverExecutableSha256),
    protocolVersion: typeof value.protocolVersion === "number" && Number.isInteger(value.protocolVersion) ? value.protocolVersion : null,
    planSchemaVersion: typeof value.planSchemaVersion === "number" && Number.isInteger(value.planSchemaVersion) ? value.planSchemaVersion : null,
    hasReproduction: typeof value.artifactKey === "string" && value.artifactKey.length > 0,
    createdAt: iso(value.createdAt),
    expiresAt: iso(value.expiresAt),
  };
}

export function toAdminReproductionData(input: {
  diagnosticId: string;
  layout: unknown;
  operbox: unknown;
  context: unknown;
  result: unknown;
  stderrExcerpt?: string | null;
  stdoutExcerpt?: string | null;
  fallbackRotation?: unknown;
  fallbackFiammettaEnabled?: unknown;
  unavailableReason?: AdminReproductionUnavailableReason;
}): AdminReproductionData {
  const layout = record(input.layout);
  const context = record(input.context);
  const result = record(input.result);
  const rawRotation = context?.rotation ?? input.fallbackRotation;
  const rotation = isRotationProfile(rawRotation) ? rawRotation : null;
  const rawFiammetta = context?.fiammettaEnabled ?? input.fallbackFiammettaEnabled;
  const fiammettaEnabled = typeof rawFiammetta === "boolean" ? rawFiammetta : null;
  const safeLayout = reproductionLayout(layout);
  const safeOperbox = reproductionOperbox(input.operbox);
  const common = {
    diagnosticId: input.diagnosticId,
    sourceName: boundedString(context?.sourceName, 80),
    error: diagnosticText(result?.error),
    stderrExcerpt: diagnosticText(input.stderrExcerpt),
    stdoutExcerpt: diagnosticText(input.stdoutExcerpt),
  };
  if (safeLayout && safeOperbox && rotation && fiammettaEnabled !== null) {
    return {
      ...common,
      available: true,
      unavailableReason: null,
      layout: safeLayout,
      operbox: safeOperbox,
      rotation,
      rotationCount: rotationShiftCount(rotation),
      fiammettaEnabled,
    };
  }
  return {
    ...common,
    available: false,
    unavailableReason: input.unavailableReason ?? "incomplete",
    layout: safeLayout,
    operbox: safeOperbox,
    rotation,
    rotationCount: rotation ? rotationShiftCount(rotation) : null,
    fiammettaEnabled,
  };
}
