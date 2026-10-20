import type { PrivateArtifactDescriptor, PlanRunSummaryInput } from "./business-records.ts";

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}

export function legacyPlanReproductionContext(debugBundle: unknown): {
  sourceName: unknown;
  rotation: unknown;
  fiammettaEnabled: unknown;
} | null {
  const debug = record(debugBundle);
  if (!debug) return null;
  const inputSummary = record(debug.inputSummary);
  const serveRequest = record(debug.serveRequest);
  const serveParams = record(serveRequest?.params);
  const serveOptions = record(serveParams?.options);
  const rotationResult = record(debug.rotationJson);
  return {
    sourceName: inputSummary?.sourceName,
    rotation: serveOptions?.rotation ?? rotationResult?.profile,
    fiammettaEnabled: serveOptions?.fiammetta_enable,
  };
}

function finiteInteger(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
}

export function legacyPlanRunSummary(input: {
  result: unknown;
  owner: unknown;
  layout: unknown;
  operboxCount: number;
  artifact: PrivateArtifactDescriptor;
  directoryCreatedAt: Date;
}): PlanRunSummaryInput | null {
  const result = record(input.result);
  const owner = record(input.owner);
  const layout = record(input.layout);
  const solver = record(result?.solver);
  const debugBundle = record(result?.debugBundle);
  const inputSummary = record(debugBundle?.inputSummary);
  const reproduction = legacyPlanReproductionContext(debugBundle);
  const diagnosticId = typeof result?.runId === "string" ? result.runId : typeof owner?.diagnosticId === "string" ? owner.diagnosticId : null;
  if (!diagnosticId || diagnosticId.length > 80 || !layout || !Array.isArray(layout.rooms)) return null;
  const startedAt = typeof result?.startedAt === "string" ? new Date(result.startedAt) : input.directoryCreatedAt;
  const createdAt = Number.isFinite(startedAt.getTime()) ? startedAt : input.directoryCreatedAt;
  const sourceName = typeof inputSummary?.sourceName === "string" ? inputSummary.sourceName : typeof owner?.sourceName === "string" ? owner.sourceName : "";
  const sourceType = owner?.ownerTag ? "skland" : sourceName.includes("示例") ? "sample" : "maa";
  return {
    diagnosticId,
    dataOwnerTag: typeof owner?.ownerTag === "string" && /^[a-f0-9]{64}$/.test(owner.ownerTag) ? owner.ownerTag : null,
    sourceType,
    status: result?.success === true ? "success" : "failed",
    layoutTemplate: typeof layout.template === "string" ? layout.template.slice(0, 120) : "legacy",
    roomCount: layout.rooms.length,
    operatorCount: finiteInteger(input.operboxCount),
    rotation: typeof debugBundle?.rotationJson === "object" && record(debugBundle.rotationJson)?.profile
      ? String(record(debugBundle.rotationJson)?.profile).slice(0, 80)
      : "legacy",
    fiammettaEnable: typeof reproduction?.fiammettaEnabled === "boolean" ? reproduction.fiammettaEnabled : true,
    durationMs: finiteInteger(result?.durationMs),
    solver: solver ? {
      protocol_version: Number.isInteger(solver.protocol_version) ? solver.protocol_version as number : null,
      plan_schema_version: Number.isInteger(solver.plan_schema_version) ? solver.plan_schema_version as number : null,
      plan_contract_sha256: typeof solver.plan_contract_sha256 === "string" ? solver.plan_contract_sha256 : null,
      solver_executable_sha256: typeof solver.solver_executable_sha256 === "string" ? solver.solver_executable_sha256 : null,
      observed_at: typeof solver.observed_at === "string" ? solver.observed_at : createdAt.toISOString(),
    } : null,
    artifact: input.artifact,
    createdAt,
  };
}

export function legacyFeedbackSummary(input: {
  meta: unknown;
  issue: unknown;
  artifact: PrivateArtifactDescriptor;
  directoryCreatedAt: Date;
}) {
  const meta = record(input.meta);
  const issue = record(input.issue);
  if (!meta || !issue || typeof meta.feedbackId !== "string" || typeof meta.diagnosticId !== "string") return null;
  const kind = meta.kind === "performance_issue" || issue.type === "performance_issue" ? "performance_issue" : "room_issue";
  const note = typeof issue.note === "string" ? issue.note.trim().slice(0, 1000) : "";
  if (!note) return null;
  const savedAt = typeof meta.savedAt === "string" ? new Date(meta.savedAt) : input.directoryCreatedAt;
  const room = kind === "room_issue" ? record(issue.room) : null;
  if (kind === "room_issue" && (!room || typeof room.id !== "string" || typeof room.title !== "string" || typeof room.group !== "string")) return null;
  return {
    feedbackId: meta.feedbackId.slice(0, 80),
    diagnosticId: meta.diagnosticId.slice(0, 80),
    kind,
    room: room ? {
      id: room.id,
      title: room.title,
      group: room.group,
      operators: Array.isArray(room.operators) ? room.operators.filter((value): value is string => typeof value === "string").slice(0, 10) : [],
    } : null,
    note,
    savedAt: Number.isFinite(savedAt.getTime()) ? savedAt : input.directoryCreatedAt,
    artifact: input.artifact,
  };
}
