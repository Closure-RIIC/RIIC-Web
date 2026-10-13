import type {
  BaseBlueprint,
  MaaJson,
  OperBoxEntry,
  PlanComputeParams,
  RotationProfile,
  SolverObservation,
  SolverPingFingerprint,
  TrainingAdviceReport,
  TrainingRoomSchedule,
} from "../types";
import { parseTrainingAdviceReport } from "../training-advice-contract.ts";
import { parseTrainingRoomSchedule } from "../training-room-contract.ts";

export type ProtocolRecord = Record<string, unknown>;

export const PLAN_PROTOCOL_VERSION = 1;
export const PLAN_SCHEMA_VERSION = 3;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const GIT_COMMIT_PATTERN = /^[0-9a-f]{40}$/;

export type PlanComputeCapability = {
  supported: boolean;
  protocolVersion: number | null;
  schemaVersion: number | null;
  supportedSchemaVersions: number[];
  contractSha256: string | null;
  solverExecutableSha256: string | null;
  reason: string | null;
};

export type SolverDeploymentReadiness = {
  ready: boolean;
  reason: string | null;
};

export type PlanComputePayload = {
  profile: ProtocolRecord;
  rotation: ProtocolRecord & { shifts: unknown[] };
  maa: ProtocolRecord;
  trainingRoom?: TrainingRoomSchedule;
  trainingAdvice: TrainingAdviceReport;
};

export function createPlanComputeParams(input: {
  layout: BaseBlueprint;
  operbox: OperBoxEntry[];
  sourceName?: string | null;
  rotation: RotationProfile;
  fiammettaEnable?: boolean;
}): PlanComputeParams {
  return {
    schema_version: PLAN_SCHEMA_VERSION,
    layout: input.layout,
    operbox: input.operbox,
    labels: {
      layout: input.layout.template,
      operbox: input.sourceName ?? null,
    },
    options: {
      rotation: input.rotation,
      top: 20,
      system_preferences: {},
      maa_title: `${input.sourceName ?? "Arknights InfraCalc"} · ${input.layout.template}`,
      fiammetta_enable: input.fiammettaEnable ?? true,
    },
  };
}

export function isProtocolRecord(value: unknown): value is ProtocolRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeSha256(value: unknown): string | null {
  return typeof value === "string" && SHA256_PATTERN.test(value) ? value : null;
}

function normalizeGitCommit(value: unknown): string | null {
  return typeof value === "string" && GIT_COMMIT_PATTERN.test(value) ? value : null;
}

function normalizeTimestamp(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function inspectContractSha256ByVersion(value: unknown): SolverPingFingerprint["planContractSha256ByVersion"] {
  if (!isProtocolRecord(value)) return [];

  return Object.entries(value)
    .flatMap(([rawVersion, rawSha256]) => {
      const version = Number(rawVersion);
      const sha256 = normalizeSha256(rawSha256);
      return Number.isSafeInteger(version) && version > 0 && String(version) === rawVersion && sha256
        ? [{ version, sha256 }]
        : [];
    })
    .sort((left, right) => left.version - right.version);
}

export function inspectSolverPingFingerprint(response: unknown): SolverPingFingerprint {
  const envelope = isProtocolRecord(response) ? response : {};
  const solver = isProtocolRecord(envelope.solver) ? envelope.solver : {};
  const result = isProtocolRecord(envelope.result) ? envelope.result : {};

  return {
    elapsedMs: typeof envelope.elapsed_ms === "number" && Number.isFinite(envelope.elapsed_ms) && envelope.elapsed_ms >= 0
      ? envelope.elapsed_ms
      : null,
    envelopeSolverGitCommit: normalizeGitCommit(solver.git_commit),
    envelopeSolverBuiltAt: normalizeTimestamp(solver.built_at),
    pong: result.pong === true,
    protocolVersion: Number.isInteger(result.protocol_version) ? result.protocol_version as number : null,
    planSchemaVersion: Number.isInteger(result.plan_schema_version) ? result.plan_schema_version as number : null,
    supportedPlanSchemaVersions: Array.isArray(result.supported_plan_schema_versions)
      ? result.supported_plan_schema_versions.filter((version): version is number => Number.isInteger(version))
      : [],
    planContractSha256: normalizeSha256(result.plan_contract_sha256),
    planContractSha256ByVersion: inspectContractSha256ByVersion(result.plan_contract_sha256_by_version),
    solverExecutableSha256: normalizeSha256(result.solver_executable_sha256),
    solverGitCommit: normalizeGitCommit(result.solver_git_commit),
    solverBuiltAt: normalizeTimestamp(result.solver_built_at),
  };
}

export function inspectPlanComputeCapability(response: unknown): PlanComputeCapability {
  const envelope = isProtocolRecord(response) ? response : {};
  const fingerprint = inspectSolverPingFingerprint(response);
  const protocolVersion = fingerprint.protocolVersion;
  const schemaVersion = fingerprint.planSchemaVersion;
  const supportedSchemaVersions = fingerprint.supportedPlanSchemaVersions;
  const contractSha256 = fingerprint.planContractSha256;
  const solverExecutableSha256 = fingerprint.solverExecutableSha256;
  const base = {
    protocolVersion,
    schemaVersion,
    supportedSchemaVersions,
    contractSha256,
    solverExecutableSha256,
  };

  if (envelope.ok !== true) {
    return {
      ...base,
      supported: false,
      reason: "ping 未返回成功响应",
    };
  }
  if (protocolVersion !== PLAN_PROTOCOL_VERSION) {
    return {
      ...base,
      supported: false,
      reason: `protocol_version 需要 ${PLAN_PROTOCOL_VERSION}，当前为 ${protocolVersion ?? "缺失"}`,
    };
  }
  if (!supportedSchemaVersions.includes(PLAN_SCHEMA_VERSION)) {
    return {
      ...base,
      supported: false,
      reason: `plan_schema_version 需要支持 ${PLAN_SCHEMA_VERSION}，当前支持 ${
        supportedSchemaVersions.length ? supportedSchemaVersions.join(", ") : "缺失"
      }`,
    };
  }

  return {
    ...base,
    supported: true,
    reason: null,
  };
}

export function inspectSolverDeploymentReadiness(
  capability: PlanComputeCapability,
  expectedSolverExecutableSha256: string | undefined
): SolverDeploymentReadiness {
  if (expectedSolverExecutableSha256 === undefined) {
    return { ready: true, reason: null };
  }

  if (!capability.supported) {
    return {
      ready: false,
      reason: capability.reason ?? "Worker 协议版本不兼容",
    };
  }

  const expected = normalizeSha256(expectedSolverExecutableSha256);
  if (!expected) {
    return {
      ready: false,
      reason: "INFRA_CLI_EXPECTED_SHA256 不是有效的小写 SHA-256 指纹",
    };
  }
  if (capability.solverExecutableSha256 !== expected) {
    return {
      ready: false,
      reason: capability.solverExecutableSha256
        ? "Worker 自报的求解器制品指纹与部署制品不一致"
        : "Worker 未返回有效的 solver_executable_sha256",
    };
  }

  return { ready: true, reason: null };
}

export function createSolverObservation(
  capability: PlanComputeCapability,
  observedAt: string
): SolverObservation {
  return {
    protocol_version: capability.protocolVersion,
    plan_schema_version: capability.schemaVersion,
    plan_contract_sha256: capability.contractSha256,
    solver_executable_sha256: capability.solverExecutableSha256,
    observed_at: observedAt,
  };
}

export function parseSolverObservation(value: unknown): SolverObservation | null {
  if (!isProtocolRecord(value) || typeof value.observed_at !== "string") return null;
  const observedAt = value.observed_at;
  if (!Number.isFinite(Date.parse(observedAt))) return null;

  const protocolVersion = value.protocol_version;
  const schemaVersion = value.plan_schema_version;
  if (protocolVersion !== null && !Number.isInteger(protocolVersion)) return null;
  if (schemaVersion !== null && !Number.isInteger(schemaVersion)) return null;

  return {
    protocol_version: protocolVersion as number | null,
    plan_schema_version: schemaVersion as number | null,
    plan_contract_sha256: normalizeSha256(value.plan_contract_sha256),
    solver_executable_sha256: normalizeSha256(value.solver_executable_sha256),
    observed_at: observedAt,
  };
}

export function solverObservationFromPlanRecord(value: unknown): SolverObservation | null {
  return isProtocolRecord(value) ? parseSolverObservation(value.solver) : null;
}

export function assertUniqueOperboxIdentities(entries: OperBoxEntry[]) {
  const ids = new Set<string>();
  const names = new Set<string>();

  for (const [index, entry] of entries.entries()) {
    const id = entry.id.trim();
    const name = entry.name.trim();
    if (!id || !name) {
      throw new Error(`operbox[${index}] 的 id 和 name 必须为非空字符串。`);
    }
    if (id !== entry.id || name !== entry.name) {
      throw new Error(`operbox[${index}] 的 id 和 name 不能包含首尾空格。`);
    }
    if (ids.has(id)) {
      throw new Error(`operbox 干员 ID 重复：${id}。`);
    }
    if (names.has(name)) {
      throw new Error(`operbox 干员名称重复：${name}。`);
    }
    ids.add(id);
    names.add(name);
  }
}

export function parsePlanComputePayload(response: unknown): PlanComputePayload | null {
  if (!isProtocolRecord(response) || response.ok !== true) return null;
  if (!isProtocolRecord(response.result)) {
    throw new Error("plan.compute 成功响应缺少 result 对象。");
  }

  const result = response.result;
  if (result.schema_version !== PLAN_SCHEMA_VERSION) {
    throw new Error(`plan.compute 响应 schema_version 应为 ${PLAN_SCHEMA_VERSION}。`);
  }
  if (!isProtocolRecord(result.profile)) {
    throw new Error("plan.compute 成功响应缺少 profile 对象。");
  }
  if (!isProtocolRecord(result.rotation) || !Array.isArray(result.rotation.shifts)) {
    throw new Error("plan.compute 成功响应缺少 rotation.shifts 数组。");
  }
  if (!isProtocolRecord(result.maa)) {
    throw new Error("plan.compute 成功响应缺少 maa 对象。");
  }

  const trainingRoom = result.training_room === undefined
    ? undefined
    : parseTrainingRoomSchedule(result.training_room, result.maa as unknown as MaaJson);

  return {
    profile: result.profile,
    rotation: { ...result.rotation, shifts: result.rotation.shifts },
    maa: result.maa,
    ...(trainingRoom ? { trainingRoom } : {}),
    trainingAdvice: parseTrainingAdviceReport(result.training_advice),
  };
}
