export type JobStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
export type CaseStatus = "pending" | "running" | "completed" | "solver_failed" | "infra_interrupted";

export type RotationProfileName =
  | "abc_12_6_6"
  | "abc_12_12_12"
  | "main_backup_12_12"
  | "fiammetta_8_8_4_4"
  | "abyssal_7_5_7_5";

export type QualityBoxSource = "production" | "representative" | "high_owned";

export interface MatrixCase {
  caseId: string;
  label: string;
  source?: QualityBoxSource;
  fileName: string;
  layoutPath: string;
  operboxPath: string;
  rotation: RotationProfileName;
  top: number;
  assertInvariants?: boolean;
  provenance?: Array<{ sourceName: string; displayName: string }>;
}

export interface QualityMatrix {
  schema_version: 1;
  label: string;
  cases: MatrixCase[];
}

export interface InputSnapshot {
  caseId: string;
  label: string;
  source?: QualityBoxSource;
  layoutPath: string;
  operboxPath: string;
  rotation: RotationProfileName;
  top: number;
  assertInvariants?: boolean;
  inputSha256: string;
}

export interface BundleManifest {
  schema_version: 2;
  bundleId: string;
  fingerprintSha256: string;
  executableSha256: string;
  dataManifestSha256: string;
  dataFiles: Record<string, string>;
  bakedManifestSha256: string | null;
  installedAt: string;
  executablePath: string;
  dataDir: string;
  label: string;
  gitCommit?: string | null;
  gitCommitMessage?: string | null;
  gitCommitDate?: string | null;
  gitCommitUrl?: string | null;
  builtAt?: string | null;
  autoDiscovered?: boolean;
  embeddedData?: boolean;
}

export interface JobManifest {
  schema_version: 1;
  jobId: string;
  matrixLabel: string;
  matrixSha256: string;
  bundleId: string;
  status: JobStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  caseCount: number;
  cases: JobCaseRecord[];
  performance?: JobPerformance;
  access?: "public" | "capability";
}

export interface JobPerformance {
  workerCount: number;
  elapsedMs: number;
  caseCount: number;
  terminalCaseCount: number;
  throughputCasesPerSecond: number;
  caseCpuUserMs: number | null;
  caseCpuSystemMs: number | null;
  caseCpuTotalMs: number | null;
  averageCaseCpuCores: number | null;
  peakRssBytes: number | null;
  startedAt: string;
  finishedAt: string;
}

export interface JobCaseRecord {
  caseId: string;
  label: string;
  source?: QualityBoxSource;
  fileName: string;
  provenance?: Array<{ sourceName: string; displayName: string }>;
  inputSha256: string;
  status: CaseStatus;
  startedAt: string | null;
  finishedAt: string | null;
  resultSha256: string | null;
  fiammettaUsed?: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  performance?: CasePerformance;
}

export interface CasePerformance {
  workerId: number;
  pid: number | null;
  queuedMs: number;
  cliElapsedMs: number | null;
  elapsedMs: number;
  startedAt: string;
  finishedAt: string;
  inputBytes?: number;
  outputBytes?: number;
  error?: string | null;
  resources?: CaseResourceUsage;
}

export interface CaseResourceUsage {
  cpuUserMs: number | null;
  cpuSystemMs: number | null;
  cpuTotalMs: number | null;
  rssBaselineBytes: number | null;
  rssPeakBytes: number | null;
  rssPeakDeltaBytes: number | null;
}

export interface CaseResult {
  schema_version: 1;
  caseId: string;
  label: string;
  source?: QualityBoxSource;
  fileName?: string;
  jobId: string;
  bundleId: string;
  inputSha256: string;
  resultSha256: string;
  solver: {
    protocol_version: number | null;
    plan_schema_version: number | null;
    plan_contract_sha256: string | null;
    solver_executable_sha256: string | null;
    git_commit?: string | null;
    built_at?: string | null;
  } | null;
  ok: boolean;
  elapsedMs: number | null;
  error: {
    code: string;
    message: string;
    stage: string;
  } | null;
  summary: CaseSummaryV1 | null;
  savedFiles: {
    planRequest?: string;
    planResponse?: string;
    profile?: string;
    rotation?: string;
    maa?: string;
    serveRequest?: string;
    serveResponse?: string;
    stdout?: string;
    stderr?: string;
  };
  planPayloadSha256?: string | null;
  performance?: CasePerformance;
}

export interface CaseSummaryV1 {
  schema_version: 1;
  daily: {
    trade: number | null;
    manu: number | null;
    power: number | null;
  };
  warnings: string[];
  shifts: ShiftSummary[];
}

export interface ShiftSummary {
  index: number;
  duration_hours: number;
  active_teams: string[];
  resting_team: string;
  trade: number | null;
  manu: number | null;
  power: number | null;
  room_lines: RoomLineSummary[];
}

export interface RoomLineSummary {
  room_id: string;
  operator_count: number | null;
  trade: number | null;
  manu: number | null;
  power: number | null;
}

export interface AnnotationRecord {
  schema_version: 1;
  caseId: string;
  resultSha256: string;
  status: "through" | "issue" | "pending_review" | null;
  note: string;
  reviewer: string;
  updatedAt: string;
  revision: number;
  issues?: QualityRoomIssue[];
}

export interface QualityRoomIssue {
  id: string;
  shiftIndex: number;
  roomId: string;
  title: string;
  group: string;
  operators: string[];
  /** 旧 annotation 可缺少；新反馈必须显式写入。 */
  severity?: QualityIssueSeverity;
  note: string;
  createdAt: string;
}

export type QualityIssueSeverity = "critical" | "moderate" | "minor";

export interface JobAccessRecord {
  schema_version: 1;
  tokenSha256: string;
  createdAt: string;
}

export interface CaseDiff {
  caseId: string;
  label: string;
  source: QualityBoxSource | null;
  fileName: string | null;
  inputSha256A: string;
  inputSha256B: string;
  compatible: boolean;
  bundleA: string;
  bundleB: string;
  resultA: CaseResult | null;
  resultB: CaseResult | null;
  dailyDelta: {
    trade: number | null;
    manu: number | null;
    power: number | null;
  };
  warningsDelta: {
    added: string[];
    removed: string[];
  };
  roomChanges: RoomChange[];
}

export interface RoomChange {
  room_id: string;
  shiftIndex: number;
  operatorsA: string[];
  operatorsB: string[];
}
