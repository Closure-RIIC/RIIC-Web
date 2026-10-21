import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import type {
  AdminReproductionData,
  AdminReproductionUnavailableReason,
  BaseBlueprint,
  CliCandidate,
  DebugBundle,
  FeedbackData,
  FeedbackRequest,
  HealthApiResponse,
  OperBoxEntry,
  PlanApiResponse,
  RotationProfile,
  SolverObservation,
} from "@/types";
import { legacyAdminFeedbackStatus, toAdminReproductionData } from "./admin-record-dto";
import { isSklandConfigured, sklandDisabledReason } from "@/server/skland/session";
import { PublicApiError } from "./api-contract";
import { diagnosticText } from "./diagnostic-text.ts";
import { feedbackDirectoryGroup, toStoredFeedbackIssue } from "./feedback-record";
import {
  createPlanComputeParams,
  createSolverObservation,
  inspectPlanComputeCapability,
  inspectSolverPingFingerprint,
  inspectSolverDeploymentReadiness,
  parsePlanComputePayload,
  PLAN_PROTOCOL_VERSION,
  PLAN_SCHEMA_VERSION,
  solverObservationFromPlanRecord,
  type PlanComputeCapability,
} from "./plan-protocol";
import { normalizeRotationResult } from "@/rotation-result";
import { parseShiftFile } from "./shift-parser";
import { isRotationProfile } from "@/rotation-settings";
import {
  isLegacySklandRunDirectoryName,
  isPrivateStorageChild,
  isSafePrivateStorageRoot,
} from "./private-storage";
import { resolveRuntimeDataDir } from "./runtime-data";
import {
  deleteExpiredBusinessRecords,
  queryBusinessRecords,
  recordFeedbackIfEnabled,
  updatePlanRunArtifactBestEffort,
  updateFeedbackRecord,
  type PrivateArtifactDescriptor,
} from "./business-records";
import { BUSINESS_DATA_TTL_MS, isBusinessDatabaseReadEnabled, isBusinessFileFallbackEnabled } from "./business-config";
import { solverTimeoutMs } from "./solver-timeout";
import {
  InfraCliServeClient,
  type JsonRecord,
  type ServeResult,
} from "./serve-client";
import { registerProcessCleanup } from "./process-cleanup";
import { normalizeSolverOperbox } from "./plan-solver-input";
import { legacyPlanReproductionContext } from "./business-backfill";
import { verifySolverFallbackConfig, runWithSolverFallback, withinSolverDeadline, withSolverLane, type SolverFallbackConfig } from "./solver-fallback.ts";
import { assertCompleteSolverOutput } from "./solver-output-contract.ts";
import { toPublicPlanData } from "./public-plan.ts";
import { makeDiagnostic, persistDiagnostic } from "./request-diagnostics.ts";

type PlanRequestBody = {
  layout: BaseBlueprint;
  operbox: OperBoxEntry[];
  sourceName?: string | null;
  rotation: RotationProfile;
  fiammettaEnable?: boolean;
  dataOwnerTag?: string | null;
};

const repoRoot = path.resolve(/* turbopackIgnore: true */ process.cwd());
const bundledCliRoot = path.join(repoRoot, "bin");
const bundledDataRoot = path.join(bundledCliRoot, "data");
const bundledFixtureRoot = path.join(repoRoot, "fixtures");
const coreRoot = path.resolve(/* turbopackIgnore: true */ process.env.INFRA_CORE_ROOT || path.join(repoRoot, "..", "ArknightsInfraCalc-v2"));
const storageRoot = path.resolve(/* turbopackIgnore: true */ process.env.BETA_STORAGE_DIR || path.join(repoRoot, "server", "storage"));
const feedbackRoot = path.resolve(/* turbopackIgnore: true */ process.env.BETA_FEEDBACK_DIR || path.join(storageRoot, "feedback"));
const cliRunRoot = path.resolve(/* turbopackIgnore: true */ process.env.BETA_CLI_RUN_DIR || path.join(storageRoot, "cli-runs"));
const cliReleaseRoot = path.resolve(/* turbopackIgnore: true */ process.env.BETA_CLI_RELEASE_DIR || path.join(storageRoot, "cli-releases"));
const activeCliPath = path.join(storageRoot, "active-cli.json");
const timeoutMs = solverTimeoutMs();
export const PRIVATE_RECORD_TTL_MS = BUSINESS_DATA_TTL_MS;
const PRIVATE_MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;
const PLAN_CACHE_SOLVER_IDENTITY_TTL_MS = 60_000;
const PLAN_CACHE_SOLVER_IDENTITY_RETRY_MS = 5_000;
const PLAN_ARTIFACT_FINALIZER_CONCURRENCY = 2;
const PLAN_ARTIFACT_FINALIZER_RETRY_MS = [1_000, 5_000, 30_000] as const;
const PLAN_ARTIFACT_FINALIZER_SLOW_RETRY_MS = 5 * 60_000;
const PLAN_ARTIFACT_MISSING_RUN_GRACE_MS = 10 * 60_000;
const legacySklandPurgeMarker = path.join(storageRoot, ".skland-legacy-purge-v1.json");
let cachedPlanCacheSolverIdentity: { value: SolverObservation | null; expiresAt: number } | null = null;
let planCacheSolverIdentityTask: Promise<SolverObservation | null> | null = null;

type PlanArtifactFinalizerState = {
  queue: Array<{
    envelopePath: string;
    attempt: number;
    dependencies: PlanArtifactFinalizerDependencies;
  }>;
  queued: Set<string>;
  retryTimers: Map<string, ReturnType<typeof setTimeout>>;
  running: number;
  idleWaiters: Set<() => void>;
};

const artifactFinalizerState: PlanArtifactFinalizerState = {
  queue: [],
  queued: new Set(),
  retryTimers: new Map(),
  running: 0,
  idleWaiters: new Set(),
};

type PlanArtifactFinalizerDependencies = {
  updateArtifact: typeof updatePlanRunArtifactBestEffort;
  retryMs: readonly number[];
  slowRetryMs: number;
  missingRunGraceMs: number;
  retentionMs: number;
  now: () => number;
};

const defaultPlanArtifactFinalizerDependencies: PlanArtifactFinalizerDependencies = {
  updateArtifact: updatePlanRunArtifactBestEffort,
  retryMs: PLAN_ARTIFACT_FINALIZER_RETRY_MS,
  slowRetryMs: PLAN_ARTIFACT_FINALIZER_SLOW_RETRY_MS,
  missingRunGraceMs: PLAN_ARTIFACT_MISSING_RUN_GRACE_MS,
  retentionMs: PRIVATE_RECORD_TTL_MS,
  now: Date.now,
};

class PlanArtifactPersistenceError extends Error {
  readonly reason: "missing" | "unavailable";

  constructor(reason: "missing" | "unavailable") {
    super(reason === "missing"
      ? "Plan run record does not exist yet."
      : "Plan run artifact status could not be persisted.");
    this.reason = reason;
  }
}

function cliCandidates() {
  const platformCliName = process.platform === "win32" ? "infra-cli.exe" : "infra-cli";
  const fallbackCliName = process.platform === "win32" ? "infra-cli" : "infra-cli.exe";
  const bundledPlatformCli = path.join(bundledCliRoot, platformCliName);
  const candidates = [
    process.env.INFRA_CLI_PATH,
    readActiveCliPath(),
    bundledPlatformCli,
    path.join(repoRoot, platformCliName),
    path.join(bundledCliRoot, fallbackCliName),
    path.join(repoRoot, fallbackCliName),
    path.join(coreRoot, "target", "release", platformCliName),
    path.join(coreRoot, "target", "debug", platformCliName),
    path.join(coreRoot, "target", "release", fallbackCliName),
    path.join(coreRoot, "target", "debug", fallbackCliName),
  ].filter(Boolean) as string[];

  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
}

/**
 * A solver published independently of the website may be selected by the
 * durable active-cli pointer.  The website release hash is only a fallback
 * pin for installations that do not have an active solver release.
 */
function expectedSolverSha256ForSelectedCli() {
  return readActiveCliPath() ? undefined : process.env.INFRA_CLI_EXPECTED_SHA256;
}

function readActiveCliPath() {
  try {
    const value = JSON.parse(readFileSync(activeCliPath, "utf-8")) as { path?: unknown };
    return typeof value.path === "string" ? value.path : undefined;
  } catch {
    return undefined;
  }
}

function fileMagic(filePath: string) {
  try {
    return readFileSync(filePath).subarray(0, 4);
  } catch {
    return Buffer.alloc(0);
  }
}

function describeCliCandidate(candidate: string): CliCandidate {
  const exists = existsSync(candidate);
  if (!exists) {
    return {
      path: candidate,
      exists,
      compatible: false,
      reason: "文件不存在",
    };
  }

  const magic = fileMagic(candidate);
  const isWindowsExe = magic[0] === 0x4d && magic[1] === 0x5a;
  const isElf = magic[0] === 0x7f && magic[1] === 0x45 && magic[2] === 0x4c && magic[3] === 0x46;

  if (process.platform === "win32" && isElf) {
    return {
      path: candidate,
      exists,
      compatible: false,
      reason: "Linux ELF 二进制不能在 Windows 直接运行；请设置 INFRA_CLI_PATH 指向 Windows 版 infra-cli.exe。",
    };
  }

  if (process.platform !== "win32" && isWindowsExe) {
    return {
      path: candidate,
      exists,
      compatible: false,
      reason: "Windows PE 二进制不能在当前平台直接运行。",
    };
  }

  return {
    path: candidate,
    exists,
    compatible: true,
    reason: null,
  };
}

function cliCandidateRecords() {
  return cliCandidates().map(describeCliCandidate);
}

function resolveCliPath() {
  const candidates = cliCandidateRecords();
  const found = candidates.find((candidate) => candidate.exists && candidate.compatible);
  if (!found) {
    const details = candidates
      .map((candidate) => {
        const missing = candidate.exists ? "" : "（不存在）";
        const reason = candidate.reason ? `（${candidate.reason}）` : "";
        return `${candidate.path}${missing}${reason}`;
      })
      .join(", ");
    throw new Error(`没有找到可运行的 infra-cli，已检查：${details}`);
  }
  return found.path;
}

function resolveSampleOperboxPath() {
  const candidates = [
    path.join(bundledFixtureRoot, "operbox_full_e2.json"),
    path.join(bundledFixtureRoot, "243", "operbox_full_e2.json"),
    path.join(coreRoot, "data", "fixtures", "243", "operbox_full_e2.json"),
  ].map((candidate) => path.resolve(/* turbopackIgnore: true */ candidate));

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`没有找到样例 operbox，已检查：${candidates.join(", ")}`);
  }
  return found;
}

function isObject(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertPlanBody(body: unknown): asserts body is PlanRequestBody {
  if (!isObject(body) || !isObject(body.layout)) {
    throw new Error("请求缺少 layout 对象。");
  }
  if (!Array.isArray(body.operbox) || body.operbox.length === 0) {
    throw new Error("请求缺少非空 operbox 数组。");
  }
  if (!isRotationProfile(body.rotation)) {
    throw new Error("请求缺少受支持的 rotation 参数。");
  }
  if (body.fiammettaEnable != null && typeof body.fiammettaEnable !== "boolean") {
    throw new Error("请求的 fiammetta_enable 参数无效。");
  }
  if (body.dataOwnerTag != null && (typeof body.dataOwnerTag !== "string" || !/^[a-f0-9]{64}$/.test(body.dataOwnerTag))) {
    throw new Error("内部数据归属标识无效。");
  }
}

function safePathSegment(value: unknown) {
  const invalidPathChars = new Set(['<', '>', ':', '"', '/', "\\", "|", "?", "*"]);
  return String(value ?? "")
    .trim()
    .split("")
    .map((char) => (char.charCodeAt(0) < 32 || invalidPathChars.has(char) ? "_" : char))
    .join("")
    .replace(/\s+/g, "_")
    .slice(0, 48);
}

function makeStampedDirName(stamp: string, sourceName: unknown, id: string) {
  return [stamp.replace(/[:.]/g, "-"), safePathSegment(sourceName), id].filter(Boolean).join("_");
}

async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}

async function writeJsonAtomic(filePath: string, value: unknown, compact = false) {
  const temporaryPath = `${filePath}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporaryPath, JSON.stringify(value, null, compact ? undefined : 2), { encoding: "utf-8", flag: "wx" });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function writeTextAtomic(filePath: string, value: string) {
  const temporaryPath = `${filePath}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporaryPath, value, { encoding: "utf-8", flag: "wx" });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function readJsonIfExists(filePath: string) {
  try {
    return JSON.parse(await readFile(filePath, "utf-8")) as unknown;
  } catch {
    return undefined;
  }
}

async function readTextTail(filePath: string, maxBytes = 16 * 1024): Promise<string | null> {
  const details = await stat(filePath).catch(() => null);
  if (!details?.isFile() || details.size <= 0) return null;
  const bytesToRead = Math.min(details.size, maxBytes);
  const handle = await open(filePath, "r").catch(() => null);
  if (!handle) return null;
  try {
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, details.size - bytesToRead);
    return buffer.subarray(0, bytesRead).toString("utf-8").trim() || null;
  } finally {
    await handle.close();
  }
}

async function artifactDescriptor(
  key: string,
  filePaths: string[],
): Promise<PrivateArtifactDescriptor | null> {
  try {
    const values = await Promise.all(filePaths.map((filePath) => readFile(filePath)));
    const hash = createHash("sha256");
    let bytes = 0;
    for (const value of values) {
      bytes += value.byteLength;
      hash.update(value);
    }
    return { key, bytes, sha256: hash.digest("hex") };
  } catch {
    return null;
  }
}

async function ensurePrivateStorageBoundaries(): Promise<void> {
  const lexicalStorageRoot = path.resolve(/* turbopackIgnore: true */ storageRoot);
  const lexicalRoots = [
    path.resolve(/* turbopackIgnore: true */ cliRunRoot),
    path.resolve(/* turbopackIgnore: true */ feedbackRoot),
  ];
  if (!isSafePrivateStorageRoot(lexicalStorageRoot, [repoRoot, homedir()])) {
    throw new Error("整体存储目录配置过于宽泛。");
  }
  if (lexicalRoots.some((root) => !isPrivateStorageChild(lexicalStorageRoot, root))) {
    throw new Error("运行记录与反馈目录必须位于整体存储根目录内。");
  }
  await Promise.all([
    mkdir(lexicalStorageRoot, { recursive: true }),
    ...lexicalRoots.map((root) => mkdir(root, { recursive: true })),
  ]);
  const [resolvedStorageRoot, ...resolvedRoots] = await Promise.all([
    realpath(/* turbopackIgnore: true */ lexicalStorageRoot),
    ...lexicalRoots.map((root) => realpath(/* turbopackIgnore: true */ root)),
  ]);
  if (
    !isSafePrivateStorageRoot(resolvedStorageRoot, [repoRoot, homedir()])
    || resolvedRoots.some((root) => !isPrivateStorageChild(resolvedStorageRoot, root))
  ) {
    throw new Error("存储目录的真实路径越过了整体存储边界。");
  }
}

export async function assertPlanArtifactStorageReady(): Promise<void> {
  if (!process.env.BETA_STORAGE_DIR?.trim() || !path.isAbsolute(process.env.BETA_STORAGE_DIR)) {
    throw new Error("Worker requires an absolute BETA_STORAGE_DIR shared with the website.");
  }
  await ensurePrivateStorageBoundaries();
  // Probe the actual run directory inside the service sandbox before claiming tasks.
  const probe = path.join(cliRunRoot, `.worker-storage-probe-${randomUUID()}`);
  const handle = await open(probe, "wx", 0o600);
  try {
    await handle.writeFile("ready");
    await handle.sync();
  } finally {
    await handle.close();
    await rm(probe, { force: true });
  }
}

async function removePrivateDirectory(root: string, target: string): Promise<boolean> {
  let resolvedStorageRoot: string;
  let resolvedRoot: string;
  let resolvedTarget: string;
  try {
    [resolvedStorageRoot, resolvedRoot, resolvedTarget] = await Promise.all([
      realpath(/* turbopackIgnore: true */ storageRoot),
      realpath(/* turbopackIgnore: true */ root),
      realpath(/* turbopackIgnore: true */ target),
    ]);
  } catch (error) {
    if (isObject(error) && error.code === "ENOENT") return false;
    throw error;
  }
  if (!isSafePrivateStorageRoot(resolvedStorageRoot, [repoRoot, homedir()])) {
    throw new Error("拒绝使用过于宽泛的整体存储根目录删除数据。");
  }
  if (!isPrivateStorageChild(resolvedStorageRoot, resolvedRoot)) {
    throw new Error("运行记录与反馈目录必须位于整体存储根目录内。");
  }
  if (!isSafePrivateStorageRoot(resolvedRoot)) {
    throw new Error("拒绝从过于宽泛的存储根目录删除数据。");
  }
  if (!isPrivateStorageChild(resolvedRoot, resolvedTarget)) throw new Error("拒绝删除存储根目录之外的数据。");
  await rm(resolvedTarget, { recursive: true, force: true });
  return true;
}

async function privateDirectories(root: string) {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(root, entry.name));
  } catch (error) {
    if (isObject(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

async function runDirectories() {
  return privateDirectories(cliRunRoot);
}

async function feedbackDirectories() {
  return privateDirectories(feedbackRoot);
}

export async function deleteFeedbackArtifacts(feedbackIds: string[]): Promise<number> {
  const wanted = new Set(feedbackIds);
  if (!wanted.size) return 0;
  await ensurePrivateStorageBoundaries();
  let deleted = 0;
  for (const directory of await feedbackDirectories()) {
    const meta = await readJsonIfExists(path.join(directory, "meta.json"));
    const directoryId = path.basename(directory).match(/(?:^|_)([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i)?.[1];
    const feedbackId = isObject(meta) && typeof meta.feedbackId === "string"
      ? meta.feedbackId
      : directoryId;
    if (!feedbackId || !wanted.has(feedbackId)) continue;
    await removePrivateDirectory(feedbackRoot, directory);
    deleted += 1;
  }
  return deleted;
}

export async function deletePlanRunArtifacts(diagnosticIds: string[]): Promise<number> {
  const wanted = new Set(diagnosticIds.filter((value) => /^[a-f0-9-]{36}$/i.test(value)));
  if (!wanted.size) return 0;
  await ensurePrivateStorageBoundaries();
  let deleted = 0;
  for (const directory of await runDirectories()) {
    const directoryId = path.basename(directory).match(/(?:^|_)([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i)?.[1];
    const metadata = directoryId && wanted.has(directoryId) ? null : await ownerMetadata(directory);
    const diagnosticId = directoryId ?? (typeof metadata?.diagnosticId === "string" ? metadata.diagnosticId : null);
    if (!diagnosticId || !wanted.has(diagnosticId)) continue;
    await removePrivateDirectory(cliRunRoot, directory);
    deleted += 1;
  }
  return deleted;
}

type PrivateRunMetadata = {
  ownerTag?: unknown;
  diagnosticId?: unknown;
  sourceName?: unknown;
  createdAt?: unknown;
};

function timestampMs(value: unknown): number | null {
  const parsed = value instanceof Date
    ? value.getTime()
    : typeof value === "string" || typeof value === "number" ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function filesystemCreatedAtMs(details: { birthtimeMs: number; mtimeMs: number }): number {
  return details.birthtimeMs > 0 ? Math.min(details.birthtimeMs, details.mtimeMs) : details.mtimeMs;
}

async function ownerMetadata(directory: string): Promise<PrivateRunMetadata | null> {
  const value = await readJsonIfExists(path.join(directory, "owner.json"));
  if (isObject(value)) return value;
  const envelope = await readJsonIfExists(path.join(directory, "run-envelope.json"));
  if (!isObject(envelope)) return null;
  const result = isObject(envelope.result) ? envelope.result : null;
  const debug = result && isObject(result.debugBundle) ? result.debugBundle : null;
  const inputSummary = debug && isObject(debug.inputSummary) ? debug.inputSummary : null;
  return {
    ownerTag: envelope.dataOwnerTag,
    diagnosticId: envelope.diagnosticId,
    sourceName: inputSummary?.sourceName,
    createdAt: result?.startedAt,
  };
}

async function privateRunCreatedAtMs(
  directory: string,
  metadata: PrivateRunMetadata | null,
  details: { birthtimeMs: number; mtimeMs: number },
): Promise<number> {
  const metadataCreatedAt = timestampMs(metadata?.createdAt);
  if (metadataCreatedAt !== null) return metadataCreatedAt;
  const result = await readJsonIfExists(path.join(directory, "result.json"));
  const resultCreatedAt = isObject(result) ? timestampMs(result.startedAt) : null;
  return resultCreatedAt ?? filesystemCreatedAtMs(details);
}

export async function maintainPrivateRecords(now = Date.now()): Promise<void> {
  await ensurePrivateStorageBoundaries();
  const legacyPurgeCompleted = existsSync(legacySklandPurgeMarker);
  const legacyDiagnosticIds = new Set<string>();
  for (const directory of await runDirectories()) {
    const metadata = await ownerMetadata(directory);
    const details = await stat(directory).catch(() => null);
    const createdAt = details ? await privateRunCreatedAtMs(directory, metadata, details) : null;
    const expired = createdAt !== null && now - createdAt >= PRIVATE_RECORD_TTL_MS;
    const legacySkland = !legacyPurgeCompleted
      && !metadata?.ownerTag
      && isLegacySklandRunDirectoryName(path.basename(directory));
    if (!expired && !legacySkland) continue;
    const result = await readJsonIfExists(path.join(directory, "result.json"));
    if (legacySkland && isObject(result) && typeof result.runId === "string") legacyDiagnosticIds.add(result.runId);
    await removePrivateDirectory(cliRunRoot, directory);
  }
  if (!legacyPurgeCompleted) {
    for (const directory of await feedbackDirectories()) {
      const meta = await readJsonIfExists(path.join(directory, "meta.json"));
      if (isObject(meta) && typeof meta.diagnosticId === "string" && legacyDiagnosticIds.has(meta.diagnosticId)) {
        await removePrivateDirectory(feedbackRoot, directory);
      }
    }
    await writeJson(legacySklandPurgeMarker, { version: 1, completedAt: new Date(now).toISOString() });
  }
  await deleteExpiredBusinessRecords(new Date(now)).catch(() => {
    console.error(JSON.stringify({ level: "error", event: "business_database_cleanup_failed" }));
  });
}

async function maintainPrivateRecordsIfDue(now = Date.now()): Promise<void> {
  const state = globalForInfra.__infraPrivateMaintenance ??= {
    lastCompletedAt: 0,
    promise: null,
  };
  if (state.promise) return state.promise;
  if (now - state.lastCompletedAt < PRIVATE_MAINTENANCE_INTERVAL_MS) return;

  const pending = maintainPrivateRecords(now).then(() => {
    state.lastCompletedAt = Date.now();
  });
  state.promise = pending;
  try {
    await pending;
  } finally {
    if (state.promise === pending) state.promise = null;
  }
}

export async function deleteSklandOwnedData(ownerTags: string[]): Promise<{ runs: number; feedback: number }> {
  const allowed = new Set(ownerTags.filter((value) => /^[a-f0-9]{64}$/.test(value)));
  if (allowed.size === 0) return { runs: 0, feedback: 0 };
  const diagnosticIds = new Set<string>();
  let runs = 0;
  for (const directory of await runDirectories()) {
    const metadata = await ownerMetadata(directory);
    if (typeof metadata?.ownerTag !== "string" || !allowed.has(metadata.ownerTag)) continue;
    if (typeof metadata.diagnosticId === "string") diagnosticIds.add(metadata.diagnosticId);
    await removePrivateDirectory(cliRunRoot, directory);
    runs += 1;
  }
  let feedback = 0;
  for (const directory of await feedbackDirectories()) {
    const meta = await readJsonIfExists(path.join(directory, "meta.json"));
    if (!isObject(meta)) continue;
    const owned = typeof meta.dataOwnerTag === "string" && allowed.has(meta.dataOwnerTag);
    const linked = typeof meta.diagnosticId === "string" && diagnosticIds.has(meta.diagnosticId);
    if (!owned && !linked) continue;
    await removePrivateDirectory(feedbackRoot, directory);
    feedback += 1;
  }
  return { runs, feedback };
}

type PrivateRunLookup =
  | { status: "missing" }
  | { status: "invalid"; directory: string }
  | { status: "found"; directory: string; result: JsonRecord };

type PrivateFeedbackLookup =
  | { status: "missing" }
  | { status: "invalid"; directory: string }
  | { status: "found"; directory: string };

type PlanReproductionFallback = {
  rotation?: unknown;
  fiammettaEnabled?: unknown;
  artifactKey?: unknown;
  artifactStatus?: unknown;
  executionSource?: unknown;
  expiresAt?: unknown;
};

async function lookupPrivateRun(diagnosticId: string): Promise<PrivateRunLookup> {
  if (!/^[a-f0-9-]{36}$/i.test(diagnosticId)) return { status: "missing" };
  const suffix = `_${diagnosticId}`;
  const directory = (await runDirectories())
    .find((candidate) => path.basename(candidate).endsWith(suffix));
  if (!directory) return { status: "missing" };
  const [storedResult, envelope, failureResult] = await Promise.all([
    readJsonIfExists(path.join(directory, "result.json")),
    readJsonIfExists(path.join(directory, "run-envelope.json")),
    readJsonIfExists(path.join(directory, "task-reproduction", "result.json")),
  ]);
  const result = [storedResult, isObject(envelope) ? envelope.result : null, failureResult]
    .find((candidate): candidate is JsonRecord => isObject(candidate) && candidate.runId === diagnosticId);
  return result
    ? { status: "found", directory, result }
    : { status: "invalid", directory };
}

async function privateRunForDiagnostic(
  diagnosticId: string
): Promise<{ directory: string; result: JsonRecord } | null> {
  const lookup = await lookupPrivateRun(diagnosticId);
  return lookup.status === "found" ? lookup : null;
}

async function lookupPrivateFeedback(feedbackId: string): Promise<PrivateFeedbackLookup> {
  if (!/^[a-f0-9-]{36}$/i.test(feedbackId)) return { status: "missing" };
  const suffix = `_${feedbackId}`;
  const directory = (await feedbackDirectories())
    .find((candidate) => path.basename(candidate).endsWith(suffix));
  if (!directory) return { status: "missing" };
  const meta = await readJsonIfExists(path.join(directory, "meta.json"));
  return isObject(meta) && meta.feedbackId === feedbackId
    ? { status: "found", directory }
    : { status: "invalid", directory };
}

function textTail(value: unknown, maxBytes = 16 * 1024): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const bytes = Buffer.from(value, "utf-8");
  return bytes.subarray(Math.max(0, bytes.byteLength - maxBytes)).toString("utf-8").trim() || null;
}

function missingReproductionReason(fallback: {
  artifactKey?: unknown;
  artifactStatus?: unknown;
  executionSource?: unknown;
  expiresAt?: unknown;
}): AdminReproductionUnavailableReason {
  const expiresAt = fallback.expiresAt instanceof Date
    ? fallback.expiresAt.getTime()
    : typeof fallback.expiresAt === "string" ? new Date(fallback.expiresAt).getTime() : Number.NaN;
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) return "expired";
  if (fallback.executionSource === "cache") return "cache_hit";
  if (fallback.artifactStatus === "pending") return "finalizing";
  if (fallback.artifactStatus === "failed") return "finalization_failed";
  if (fallback.artifactStatus === "none" || typeof fallback.artifactKey !== "string" || !fallback.artifactKey) {
    return "not_recorded";
  }
  return "missing";
}

function reproductionExpired(expiresAt: unknown): boolean {
  const value = expiresAt instanceof Date
    ? expiresAt.getTime()
    : typeof expiresAt === "string" ? new Date(expiresAt).getTime() : Number.NaN;
  return Number.isFinite(value) && value <= Date.now();
}

export async function readPlanReproduction(
  diagnosticId: string,
  fallback: PlanReproductionFallback = {},
): Promise<AdminReproductionData> {
  if (reproductionExpired(fallback.expiresAt)) {
    return toAdminReproductionData({
      diagnosticId,
      layout: null,
      operbox: null,
      context: null,
      result: null,
      fallbackRotation: fallback.rotation,
      fallbackFiammettaEnabled: fallback.fiammettaEnabled,
      unavailableReason: "expired",
    });
  }
  const lookup = await lookupPrivateRun(diagnosticId);
  if (lookup.status !== "found") {
    return toAdminReproductionData({
      diagnosticId,
      layout: null,
      operbox: null,
      context: null,
      result: null,
      fallbackRotation: fallback.rotation,
      fallbackFiammettaEnabled: fallback.fiammettaEnabled,
      unavailableReason: lookup.status === "invalid" ? "invalid" : missingReproductionReason(fallback),
    });
  }
  const taskSnapshotDir = path.join(lookup.directory, "task-reproduction");
  const [layout, operbox, context, stderrExcerpt, stdoutExcerpt] = await Promise.all([
    readJsonIfExists(path.join(taskSnapshotDir, "layout.json"))
      .then((value) => value ?? readJsonIfExists(path.join(lookup.directory, "layout.json"))),
    readJsonIfExists(path.join(taskSnapshotDir, "operbox.json"))
      .then((value) => value ?? readJsonIfExists(path.join(lookup.directory, "operbox.json"))),
    readJsonIfExists(path.join(taskSnapshotDir, "reproduction.json"))
      .then((value) => value ?? readJsonIfExists(path.join(lookup.directory, "reproduction.json"))),
    readTextTail(path.join(lookup.directory, "stderr.txt")),
    readTextTail(path.join(lookup.directory, "stdout.txt")),
  ]);
  let debug = isObject(lookup.result.debugBundle) ? lookup.result.debugBundle : null;
  if (!debug && (!layout || !operbox || !context || !stderrExcerpt || !stdoutExcerpt)) {
    const storedDebug = await readJsonIfExists(path.join(lookup.directory, "debug-bundle.json"));
    debug = isObject(storedDebug) ? storedDebug : null;
  }
  const legacyContext = legacyPlanReproductionContext(debug);
  const legacyBackfillWithoutExactFiammetta = !context
    && Boolean(debug)
    && fallback.executionSource == null
    && typeof legacyContext?.fiammettaEnabled !== "boolean";
  return toAdminReproductionData({
    diagnosticId,
    layout: layout ?? debug?.layout,
    operbox: operbox ?? debug?.operbox,
    context: context ?? legacyContext,
    result: lookup.result,
    stderrExcerpt: stderrExcerpt ?? textTail(debug?.stderr),
    stdoutExcerpt: stdoutExcerpt ?? textTail(debug?.stdout),
    fallbackRotation: fallback.rotation,
    fallbackFiammettaEnabled: legacyBackfillWithoutExactFiammetta ? undefined : fallback.fiammettaEnabled,
  });
}

export async function readFeedbackReproduction(
  feedbackId: string,
  diagnosticId: string,
  options: {
    expiresAt?: unknown;
    plan?: PlanReproductionFallback;
  } = {},
): Promise<AdminReproductionData> {
  if (reproductionExpired(options.expiresAt)) {
    return toAdminReproductionData({
      diagnosticId,
      layout: null,
      operbox: null,
      context: null,
      result: null,
      fallbackRotation: options.plan?.rotation,
      fallbackFiammettaEnabled: options.plan?.fiammettaEnabled,
      unavailableReason: "expired",
    });
  }

  const [lookup, linkedRun] = await Promise.all([
    lookupPrivateFeedback(feedbackId),
    readPlanReproduction(diagnosticId, options.plan),
  ]);
  if (lookup.status === "missing") return linkedRun;
  if (lookup.status === "invalid") {
    if (linkedRun.available) return linkedRun;
    return toAdminReproductionData({
      diagnosticId,
      layout: null,
      operbox: null,
      context: null,
      result: { error: linkedRun.error },
      stderrExcerpt: linkedRun.stderrExcerpt,
      stdoutExcerpt: linkedRun.stdoutExcerpt,
      fallbackRotation: options.plan?.rotation,
      fallbackFiammettaEnabled: options.plan?.fiammettaEnabled,
      unavailableReason: "invalid",
    });
  }

  const [layout, operbox, context] = await Promise.all([
    readJsonIfExists(path.join(lookup.directory, "layout.json")),
    readJsonIfExists(path.join(lookup.directory, "operbox.json")),
    readJsonIfExists(path.join(lookup.directory, "reproduction.json")),
  ]);
  const reproduction = toAdminReproductionData({
    diagnosticId,
    layout,
    operbox,
    context,
    result: { error: linkedRun.error },
    stderrExcerpt: linkedRun.stderrExcerpt,
    stdoutExcerpt: linkedRun.stdoutExcerpt,
    fallbackRotation: options.plan?.rotation,
    fallbackFiammettaEnabled: options.plan?.fiammettaEnabled,
  });
  if (reproduction.available) return reproduction;
  return linkedRun.available ? linkedRun : reproduction;
}

async function readShiftFiles(outputDir: string) {
  try {
    const entries = await readdir(outputDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && /^team_shift_.*\.json$/i.test(entry.name))
      .map((entry) => path.join(outputDir, entry.name))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

    const shifts: unknown[] = [];
    const errors: string[] = [];
    for (const [index, file] of files.entries()) {
      const raw = await readFile(file, "utf-8").catch(() => null);
      if (!raw) {
        errors.push(`无法读取 ${path.basename(file)}`);
        continue;
      }
      const parsed = parseShiftFile(raw, index);
      if (parsed) shifts.push(parsed);
      else errors.push(`无法解析 ${path.basename(file)}`);
    }

    return { shifts, files, errors };
  } catch {
    return { shifts: [], files: [], errors: [`未找到 output_dir：${outputDir}`] };
  }
}

function countRoomsByKind(layout: BaseBlueprint, kind: string) {
  return Array.isArray(layout.rooms) ? layout.rooms.filter((room) => room.kind === kind).length : 0;
}

function serveErrorMessage(response: JsonRecord) {
  const error = response.error ?? (isObject(response.result) ? response.result.error : undefined);
  if (isObject(error) && typeof error.message === "string") return error.message;
  return "unknown error";
}

function formatPlanFailure({
  layout,
  response,
  stderr,
}: {
  layout: BaseBlueprint;
  response: JsonRecord;
  stderr: string;
}) {
  const message = serveErrorMessage(response);
  const powerAssignmentsMatch = message.match(/power: expected (\d+) assignments, got (\d+)/);
  const stderrPowerMatch = stderr.match(/发电站:\s*过滤\s*\d+\s*(?:→|->|=>|>)\s*(\d+)/);

  if (powerAssignmentsMatch) {
    const expected = Number(powerAssignmentsMatch[1]);
    const got = Number(powerAssignmentsMatch[2]);
    const layoutPowerRooms = countRoomsByKind(layout, "power_plant") || expected;
    const filteredPowerCount = stderrPowerMatch ? Number(stderrPowerMatch[1]) : got;

    return [
      `发电站候选不足：当前布局有 ${layoutPowerRooms} 个发电站，但 infra-cli 只生成了 ${got} 组发电站排班。`,
      Number.isFinite(filteredPowerCount)
        ? `CLI 日志显示当前 box 筛选后只有 ${filteredPowerCount} 名可用于发电站的候选干员。`
        : undefined,
      layoutPowerRooms > got ? "处理方式：切换到 252/342 等 2 发电站布局，或补足可用于发电站的干员后重新导出 box。" : undefined,
      `原始错误：${message}`,
      stderr?.slice(0, 1200),
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    (!response.ok || message !== "unknown error") && `infra-cli serve error: ${message}`,
    stderr?.slice(0, 1200),
  ]
    .filter(Boolean)
    .join("\n");
}

const globalForInfra = globalThis as typeof globalThis & {
  __infraCliHealthServeClient?: InfraCliServeClient;
  __infraCliPlanServeClients?: Map<number, InfraCliServeClient>;
  __infraCliPlanCapabilities?: Map<number, { generation: number; capability: PlanComputeCapability }>;
  __infraFallbackServeClients?: Map<number, InfraCliServeClient>;
  __infraCliCleanupRegistered?: boolean;
  __infraPrivateMaintenance?: {
    lastCompletedAt: number;
    promise: Promise<void> | null;
  };
};

function serveClientOptions() {
  return {
    resolveCliPath,
    resolveRuntimeDataDir,
    timeoutMs,
  };
}

function getHealthServeClient() {
  globalForInfra.__infraCliHealthServeClient ??= new InfraCliServeClient(serveClientOptions());
  return globalForInfra.__infraCliHealthServeClient;
}

function getPlanServeClient(lane = 0) {
  globalForInfra.__infraCliPlanServeClients ??= new Map();
  const existing = globalForInfra.__infraCliPlanServeClients.get(lane);
  if (existing) return existing;
  const client = new InfraCliServeClient(serveClientOptions());
  globalForInfra.__infraCliPlanServeClients.set(lane, client);
  return client;
}

function getFallbackServeClient(lane: number, config: SolverFallbackConfig) {
  globalForInfra.__infraFallbackServeClients ??= new Map();
  const existing=globalForInfra.__infraFallbackServeClients.get(lane);
  if(existing) return existing;
  const client=new InfraCliServeClient({resolveCliPath:()=>config.cliPath,resolveRuntimeDataDir:()=>config.dataDir,
    cwd:()=>path.dirname(config.cliPath),childEnv:{RAYON_NUM_THREADS:"1"},timeoutMs});
  globalForInfra.__infraFallbackServeClients.set(lane,client);
  return client;
}

export async function warmPlanServeLane(serveLane: number): Promise<void> {
  if (!Number.isSafeInteger(serveLane) || serveLane < 0) {
    throw new Error("Plan solver lane must be a non-negative integer.");
  }
  const serveClient = getPlanServeClient(serveLane);
  const ping = await serveClient.ping();
  const capability = inspectPlanComputeCapability(ping.response);
  globalForInfra.__infraCliPlanCapabilities ??= new Map();
  globalForInfra.__infraCliPlanCapabilities.set(serveLane, {
    generation: serveClient.info().restartCount,
    capability,
  });
  if (serveLane === 0 && capability.supported && capability.solverExecutableSha256) {
    cachedPlanCacheSolverIdentity = {
      value: createSolverObservation(capability, new Date().toISOString()),
      expiresAt: Date.now() + PLAN_CACHE_SOLVER_IDENTITY_TTL_MS,
    };
  }
  const readiness = inspectSolverDeploymentReadiness(
    capability,
    expectedSolverSha256ForSelectedCli(),
  );
  if (!readiness.ready) {
    throw new Error(`Plan solver lane ${serveLane} is not ready: ${readiness.reason ?? "unknown reason"}`);
  }
  const fallback=verifySolverFallbackConfig();
  if(fallback) {
    const fallbackPing=await getFallbackServeClient(serveLane,fallback).ping();
    const fallbackReady=inspectSolverDeploymentReadiness(inspectPlanComputeCapability(fallbackPing.response),fallback.sha256);
    if(!fallbackReady.ready) throw new Error(`Fallback solver lane ${serveLane} is not ready: ${fallbackReady.reason}`);
  }
}

export function stopInfraServeClients(reason: string) {
  globalForInfra.__infraCliHealthServeClient?.stop(reason);
  for (const client of globalForInfra.__infraCliPlanServeClients?.values() ?? []) client.stop(reason);
  for (const client of globalForInfra.__infraFallbackServeClients?.values() ?? []) client.stop(reason);
  globalForInfra.__infraCliPlanCapabilities?.clear();
}

async function getPlanServeCapability(serveLane: number, serveClient: InfraCliServeClient): Promise<PlanComputeCapability> {
  const info = serveClient.info();
  const cached = globalForInfra.__infraCliPlanCapabilities?.get(serveLane);
  if (info.running && cached?.generation === info.restartCount) return cached.capability;
  const ping = await serveClient.ping();
  const capability = inspectPlanComputeCapability(ping.response);
  globalForInfra.__infraCliPlanCapabilities ??= new Map();
  globalForInfra.__infraCliPlanCapabilities.set(serveLane, {
    generation: serveClient.info().restartCount,
    capability,
  });
  return capability;
}

function registerServeClientCleanup() {
  if (globalForInfra.__infraCliCleanupRegistered) return;
  globalForInfra.__infraCliCleanupRegistered = true;
  registerProcessCleanup(process, stopInfraServeClients);
}

registerServeClientCleanup();

export async function getHealth(): Promise<HealthApiResponse> {
  void maintainPrivateRecordsIfDue().catch(() => undefined);
  try {
    const candidates = cliCandidateRecords();
    const runnableCandidate = candidates.find((candidate) => candidate.exists && candidate.compatible);
    const cliPath = runnableCandidate?.path;
    const samplePath = (() => {
      try {
        return resolveSampleOperboxPath();
      } catch {
        return null;
      }
    })();
    const dataPath = cliPath ? resolveRuntimeDataDir(cliPath) : null;
    const healthServeClient = getHealthServeClient();
    let serve: NonNullable<HealthApiResponse["serve"]> = healthServeClient.info();
    let serveError = runnableCandidate
      ? null
      : candidates.find((candidate) => candidate.exists && candidate.reason)?.reason ?? "未找到可运行的 infra-cli。";

    if (cliPath) {
      try {
        const pingResult = await healthServeClient.ping();
        const planCompute = inspectPlanComputeCapability(pingResult.response);
        const fingerprint = inspectSolverPingFingerprint(pingResult.response);
        const deploymentReadiness = inspectSolverDeploymentReadiness(
          planCompute,
          expectedSolverSha256ForSelectedCli()
        );
        serve = {
          ...healthServeClient.info(),
          protocolMode: planCompute.supported ? "plan.compute" : "legacy",
          planCompute,
          fingerprint,
        };
        if (!deploymentReadiness.ready) {
          serveError = deploymentReadiness.reason;
        }
      } catch (error) {
        serveError = error instanceof Error ? error.message : String(error);
      }
    }

    return {
      ok: true,
      apiReady: true,
      cliReady: Boolean(cliPath) && !serveError,
      cliPath: cliPath ?? null,
      serve,
      serveError,
      candidates,
      coreRoot,
      repoRoot,
      bundledCliRoot,
      bundledDataRoot,
      samplePath,
      dataPath,
      storageRoot,
      feedbackRoot,
      cliRunRoot,
      sklandConfigured: isSklandConfigured(),
      sklandDisabledReason: sklandDisabledReason(),
    };
  } catch (error) {
    return {
      ok: true,
      apiReady: true,
      cliReady: false,
      cliPath: null,
      sklandConfigured: isSklandConfigured(),
      sklandDisabledReason: sklandDisabledReason(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getPlanCacheSolverIdentity(): Promise<SolverObservation | null> {
  const now = Date.now();
  if (cachedPlanCacheSolverIdentity && cachedPlanCacheSolverIdentity.expiresAt > now) {
    return cachedPlanCacheSolverIdentity.value;
  }

  const planClient = globalForInfra.__infraCliPlanServeClients?.get(0);
  const planCapability = globalForInfra.__infraCliPlanCapabilities?.get(0);
  if (
    planClient?.info().running
    && planCapability?.generation === planClient.info().restartCount
    && planCapability.capability.supported
    && planCapability.capability.solverExecutableSha256
  ) {
    const value = createSolverObservation(planCapability.capability, new Date().toISOString());
    cachedPlanCacheSolverIdentity = {
      value,
      expiresAt: now + PLAN_CACHE_SOLVER_IDENTITY_TTL_MS,
    };
    return value;
  }

  if (planCacheSolverIdentityTask) return planCacheSolverIdentityTask;
  const serveClient = planClient ?? getHealthServeClient();
  if (serveClient.info().busy) return null;

  const task = (async () => {
    let value: SolverObservation | null = null;
    try {
      resolveCliPath();
      const capability = planClient
        ? await getPlanServeCapability(0, planClient)
        : inspectPlanComputeCapability((await serveClient.ping()).response);
      if (capability.supported && capability.solverExecutableSha256) {
        const readiness = inspectSolverDeploymentReadiness(capability, expectedSolverSha256ForSelectedCli());
        if (readiness.ready) value = createSolverObservation(capability, new Date().toISOString());
      }
    } catch {
      value = null;
    }
    cachedPlanCacheSolverIdentity = {
      value,
      expiresAt: Date.now() + (value ? PLAN_CACHE_SOLVER_IDENTITY_TTL_MS : PLAN_CACHE_SOLVER_IDENTITY_RETRY_MS),
    };
    return value;
  })();
  planCacheSolverIdentityTask = task;
  try {
    return await task;
  } finally {
    if (planCacheSolverIdentityTask === task) planCacheSolverIdentityTask = null;
  }
}

export function getCachedPlanCacheSolverIdentity(): SolverObservation | null {
  const current = cachedPlanCacheSolverIdentity?.value ?? null;
  if (!cachedPlanCacheSolverIdentity || cachedPlanCacheSolverIdentity.expiresAt <= Date.now()) {
    void getPlanCacheSolverIdentity().catch(() => undefined);
  }
  if (current) return current;
  const expectedSha256 = expectedSolverSha256ForSelectedCli()?.trim();
  if (!expectedSha256 || !/^[a-f0-9]{64}$/.test(expectedSha256)) return null;
  return {
    protocol_version: PLAN_PROTOCOL_VERSION,
    plan_schema_version: PLAN_SCHEMA_VERSION,
    plan_contract_sha256: null,
    solver_executable_sha256: expectedSha256,
    observed_at: new Date().toISOString(),
  };
}

export async function getSampleOperbox() {
  const samplePath = resolveSampleOperboxPath();
  const sample = JSON.parse(await readFile(samplePath, "utf-8")) as unknown;
  return {
    success: true,
    sourceName: "243 全精二示例",
    operbox: sample,
  };
}

export async function saveFeedback(
  body: FeedbackRequest,
  options: { userId?: string | null; dataOwnerTag?: string | null } = {},
): Promise<FeedbackData> {
  const savedAt = new Date().toISOString();
  const feedbackId = randomUUID();
  const kind = body.kind ?? "room_issue";
  const dirName = makeStampedDirName(savedAt, feedbackDirectoryGroup(body), feedbackId);
  const feedbackDir = path.join(feedbackRoot, dirName);
  const metaPath = path.join(feedbackDir, "meta.json");
  const issuePath = path.join(feedbackDir, "issue.json");
  const layoutPath = path.join(feedbackDir, "layout.json");
  const operboxPath = path.join(feedbackDir, "operbox.json");
  const reproductionPath = path.join(feedbackDir, "reproduction.json");

  const reproduction = toAdminReproductionData({
    diagnosticId: body.diagnosticId,
    layout: body.reproduction.layout,
    operbox: body.reproduction.operbox,
    context: {
      ...body.reproduction,
      sourceName: body.reproduction.sourceType === "skland" ? "森空岛同步" : "MAA 导入",
    },
    result: null,
  });
  if (!reproduction.available) throw new PublicApiError("AIC-FEEDBACK-4001");
  await mkdir(feedbackDir, { recursive: true });

  const linkedRun = await privateRunForDiagnostic(body.diagnosticId);
  const owner = linkedRun ? await ownerMetadata(linkedRun.directory) : null;
  const linkedDataOwnerTag = owner?.diagnosticId === body.diagnosticId && typeof owner.ownerTag === "string"
    ? owner.ownerTag
    : null;
  const dataOwnerTag = options.dataOwnerTag ?? linkedDataOwnerTag;
  const solver = solverObservationFromPlanRecord(linkedRun?.result);
  const meta = {
    version: "feedback-record-v2",
    feedbackId,
    savedAt,
    diagnosticId: body.diagnosticId,
    kind,
    consent: body.consent,
    solver,
    ...(linkedRun ? {
      runArtifact: path.relative(storageRoot, existsSync(path.join(linkedRun.directory, "run-envelope.json"))
        ? path.join(linkedRun.directory, "run-envelope.json")
        : path.join(linkedRun.directory, "result.json")),
    } : {}),
    ...(dataOwnerTag ? { dataOwnerTag } : {}),
  };

  await Promise.all([
    writeJson(metaPath, meta),
    writeJson(issuePath, toStoredFeedbackIssue(body)),
    writeJson(layoutPath, reproduction.layout),
    writeJson(operboxPath, reproduction.operbox),
    writeJson(reproductionPath, {
      version: 1,
      diagnosticId: body.diagnosticId,
      sourceName: reproduction.sourceName,
      sourceType: body.reproduction.sourceType,
      rotation: reproduction.rotation,
      rotationCount: reproduction.rotationCount,
      fiammettaEnabled: reproduction.fiammettaEnabled,
    }),
  ]);
  await recordFeedbackIfEnabled({
    feedbackId,
    savedAt: new Date(savedAt),
    body,
    userId: options.userId ?? null,
    artifact: await artifactDescriptor(feedbackId, [metaPath, issuePath, layoutPath, operboxPath, reproductionPath]),
  });

  return {
    feedbackId,
    savedAt,
  };
}

export async function savePlanFailureArtifact(input: PlanRequestBody & {
  diagnosticId: string;
  errorCode: string;
  diagnosticReason?: string | null;
}): Promise<PrivateArtifactDescriptor | null> {
  assertPlanBody(input);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.diagnosticId)) {
    throw new Error("Plan failure diagnostic ID is invalid.");
  }

  await ensurePrivateStorageBoundaries();
  const startedAt = new Date().toISOString();
  const suffix = `_${input.diagnosticId}`;
  const existingDir = (await runDirectories())
    .find((candidate) => path.basename(candidate).endsWith(suffix));
  if (existingDir) {
    const envelopePath = path.join(existingDir, "run-envelope.json");
    const resultPath = path.join(existingDir, "result.json");
    const existingArtifact = existsSync(envelopePath)
      ? envelopePath
      : existsSync(resultPath) ? resultPath : null;
    const snapshotDir = path.join(existingDir, "task-reproduction");
    const snapshotPaths = [
      path.join(snapshotDir, "layout.json"),
      path.join(snapshotDir, "operbox.json"),
      path.join(snapshotDir, "reproduction.json"),
      path.join(snapshotDir, "result.json"),
    ];
    if (snapshotPaths.every((filePath) => existsSync(filePath))) {
      return artifactDescriptor(input.diagnosticId, [
        ...(existingArtifact ? [existingArtifact] : []),
        ...snapshotPaths,
      ]);
    }

    const writeSnapshot = async (target: string) => Promise.all([
      writeJsonAtomic(path.join(target, "layout.json"), input.layout),
      writeJsonAtomic(path.join(target, "operbox.json"), input.operbox),
      writeJsonAtomic(path.join(target, "reproduction.json"), {
        version: 1,
        diagnosticId: input.diagnosticId,
        sourceName: input.sourceName ?? null,
        rotation: input.rotation,
        fiammettaEnabled: input.fiammettaEnable ?? true,
      }),
      writeJsonAtomic(path.join(target, "result.json"), {
        success: false,
        startedAt,
        durationMs: 0,
        error: diagnosticText(input.diagnosticReason) ?? input.errorCode,
        runId: input.diagnosticId,
      } satisfies PlanApiResponse),
    ]);
    if (existsSync(snapshotDir)) {
      await writeSnapshot(snapshotDir);
    } else {
      const stagingSnapshotDir = `${snapshotDir}.pending-${randomUUID()}`;
      await mkdir(stagingSnapshotDir);
      try {
        await writeSnapshot(stagingSnapshotDir);
        await rename(stagingSnapshotDir, snapshotDir);
      } catch (error) {
        await rm(stagingSnapshotDir, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
    }
    return artifactDescriptor(input.diagnosticId, [
      ...(existingArtifact ? [existingArtifact] : []),
      ...snapshotPaths,
    ]);
  }

  const runDir = path.join(
    cliRunRoot,
    makeStampedDirName(startedAt, input.sourceName, input.diagnosticId),
  );
  const stagingDir = `${runDir}.pending-${randomUUID()}`;
  const layoutPath = path.join(stagingDir, "layout.json");
  const operboxPath = path.join(stagingDir, "operbox.json");
  const reproductionPath = path.join(stagingDir, "reproduction.json");
  const resultPath = path.join(stagingDir, "result.json");
  const ownerPath = path.join(stagingDir, "owner.json");
  const artifactPaths = [layoutPath, operboxPath, reproductionPath, resultPath];

  await mkdir(stagingDir);
  try {
    await Promise.all([
      writeJsonAtomic(layoutPath, input.layout),
      writeJsonAtomic(operboxPath, input.operbox),
      writeJsonAtomic(reproductionPath, {
        version: 1,
        diagnosticId: input.diagnosticId,
        sourceName: input.sourceName ?? null,
        rotation: input.rotation,
        fiammettaEnabled: input.fiammettaEnable ?? true,
      }),
      writeJsonAtomic(resultPath, {
        success: false,
        startedAt,
        durationMs: 0,
        error: diagnosticText(input.diagnosticReason) ?? input.errorCode,
        runId: input.diagnosticId,
      } satisfies PlanApiResponse),
      ...(input.dataOwnerTag ? [
        writeJsonAtomic(ownerPath, {
          version: 1,
          ownerTag: input.dataOwnerTag,
          diagnosticId: input.diagnosticId,
          sourceName: input.sourceName ?? null,
          createdAt: startedAt,
        }, true),
      ] : []),
    ]);
    if (input.dataOwnerTag) artifactPaths.push(ownerPath);
    await rename(stagingDir, runDir);
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  return artifactDescriptor(
    input.diagnosticId,
    artifactPaths.map((filePath) => path.join(runDir, path.basename(filePath))),
  );
}

export async function describePlanArtifact(result: PlanApiResponse): Promise<PrivateArtifactDescriptor | null> {
  const artifactPath = result.artifactEnvelopePath ?? result.resultPath;
  if (!result.runId || !artifactPath) return null;
  const resolved = path.resolve(/* turbopackIgnore: true */ artifactPath);
  const root = path.resolve(/* turbopackIgnore: true */ cliRunRoot);
  if (!isPrivateStorageChild(root, resolved)) return null;
  return artifactDescriptor(result.runId, [resolved]);
}

type PlanRunEnvelope = {
  version: "plan-run-envelope-v1";
  diagnosticId: string;
  dataOwnerTag: string | null;
  result: PlanApiResponse;
};

function parsePlanRunEnvelope(value: unknown): PlanRunEnvelope {
  if (!isObject(value) || value.version !== "plan-run-envelope-v1" || typeof value.diagnosticId !== "string" || !isObject(value.result)) {
    throw new Error("Plan run envelope is invalid.");
  }
  return value as unknown as PlanRunEnvelope;
}

export async function finalizePlanArtifactEnvelope(
  envelopePath: string,
  dependencies: PlanArtifactFinalizerDependencies = defaultPlanArtifactFinalizerDependencies,
): Promise<void> {
  const resolvedEnvelope = path.resolve(/* turbopackIgnore: true */ envelopePath);
  const root = path.resolve(/* turbopackIgnore: true */ cliRunRoot);
  if (!isPrivateStorageChild(root, resolvedEnvelope)) throw new Error("Plan run envelope is outside private storage.");
  const runDir = path.dirname(resolvedEnvelope);
  const envelope = parsePlanRunEnvelope(JSON.parse(await readFile(resolvedEnvelope, "utf-8")) as unknown);
  const { result } = envelope;
  const expandedMarkerPath = path.join(runDir, "artifact-expanded.json");
  if (!existsSync(expandedMarkerPath)) {
    const debug = result.debugBundle;
    const writes: Promise<unknown>[] = [
      writeJsonAtomic(path.join(runDir, "result.json"), result),
    ];
    if (debug) {
      writes.push(
        writeJsonAtomic(path.join(runDir, "debug-bundle.json"), debug),
        writeJsonAtomic(path.join(runDir, "layout.json"), debug.layout),
        writeJsonAtomic(path.join(runDir, "operbox.json"), debug.operbox),
        writeTextAtomic(path.join(runDir, "stdout.txt"), debug.stdout),
        writeTextAtomic(path.join(runDir, "stderr.txt"), debug.stderr),
        writeTextAtomic(path.join(runDir, "command.txt"), debug.command),
      );
      if (debug.profileJson) writes.push(writeJsonAtomic(path.join(runDir, "profile.json"), debug.profileJson));
      if (debug.maaJson) writes.push(writeJsonAtomic(path.join(runDir, "maa.json"), debug.maaJson));
      if (debug.serveRequest) {
        writes.push(
          writeJsonAtomic(path.join(runDir, "serve-request.json"), debug.serveRequest),
          writeTextAtomic(path.join(runDir, "serve-request.jsonl"), `${JSON.stringify(debug.serveRequest)}\n`),
        );
      }
      if (debug.serveResponse) writes.push(writeJsonAtomic(path.join(runDir, "serve-response.json"), debug.serveResponse));
    }
    if (envelope.dataOwnerTag) {
      writes.push(writeJsonAtomic(path.join(runDir, "owner.json"), {
        version: 1,
        ownerTag: envelope.dataOwnerTag,
        diagnosticId: envelope.diagnosticId,
        sourceName: debug?.inputSummary.sourceName ?? null,
        createdAt: result.startedAt ?? new Date().toISOString(),
      }));
    }
    await Promise.all(writes);
    await writeJsonAtomic(expandedMarkerPath, {
      version: 1,
      diagnosticId: envelope.diagnosticId,
      expandedAt: new Date().toISOString(),
    }, true);
  }
  const finalizedAt = new Date();
  const artifactRecorded = await dependencies.updateArtifact({
    diagnosticId: envelope.diagnosticId,
    status: "complete",
    artifact: await artifactDescriptor(envelope.diagnosticId, [resolvedEnvelope]),
    finalizedAt,
  });
  if (artifactRecorded !== "updated") throw new PlanArtifactPersistenceError(artifactRecorded);
  await writeJsonAtomic(path.join(runDir, "artifact-finalized.json"), {
    version: 1,
    diagnosticId: envelope.diagnosticId,
    finalizedAt: finalizedAt.toISOString(),
  }, true);
}

function settleArtifactFinalizerIdle() {
  if (
    artifactFinalizerState.running !== 0
    || artifactFinalizerState.queue.length !== 0
    || artifactFinalizerState.retryTimers.size !== 0
  ) return;
  for (const resolve of artifactFinalizerState.idleWaiters) resolve();
  artifactFinalizerState.idleWaiters.clear();
}

function schedulePlanArtifactRetry(
  envelopePath: string,
  attempt: number,
  delayMs: number,
  dependencies: PlanArtifactFinalizerDependencies,
) {
  const timer = setTimeout(() => {
    artifactFinalizerState.retryTimers.delete(envelopePath);
    artifactFinalizerState.queue.push({ envelopePath, attempt, dependencies });
    pumpArtifactFinalizers();
  }, delayMs);
  timer.unref();
  artifactFinalizerState.retryTimers.set(envelopePath, timer);
}

function pumpArtifactFinalizers() {
  while (
    artifactFinalizerState.running < PLAN_ARTIFACT_FINALIZER_CONCURRENCY
    && artifactFinalizerState.queue.length > 0
  ) {
    const item = artifactFinalizerState.queue.shift();
    if (!item) break;
    const { envelopePath, attempt, dependencies } = item;
    artifactFinalizerState.running += 1;
    let retryScheduled = false;
    void finalizePlanArtifactEnvelope(envelopePath, dependencies)
      .catch(async (error) => {
        const retryDelayMs = dependencies.retryMs[attempt];
        retryScheduled = retryDelayMs !== undefined;
        console.error(JSON.stringify({
          level: "error",
          event: "plan_artifact_finalization_failed",
          envelopePath,
          attempt: attempt + 1,
          retryDelayMs: retryDelayMs ?? null,
          message: error instanceof Error ? error.message : String(error),
        }));
        if (!existsSync(envelopePath)) {
          retryScheduled = false;
          return;
        }
        let envelope: PlanRunEnvelope;
        try {
          envelope = parsePlanRunEnvelope(await readJsonIfExists(envelopePath));
        } catch {
          retryScheduled = false;
          const quarantined = await writeJsonAtomic(path.join(path.dirname(envelopePath), "artifact-failed.json"), {
            version: 1,
            diagnosticId: null,
            failedAt: new Date().toISOString(),
            reason: "invalid-envelope",
          }, true).then(() => true, () => false);
          if (!quarantined) {
            retryScheduled = true;
            schedulePlanArtifactRetry(envelopePath, attempt, dependencies.slowRetryMs, dependencies);
          }
          return;
        }
        let envelopeAgeMs: number;
        try {
          const details = await stat(envelopePath);
          const createdAt = timestampMs(envelope.result.startedAt) ?? filesystemCreatedAtMs(details);
          envelopeAgeMs = Math.max(0, dependencies.now() - createdAt);
        } catch {
          retryScheduled = false;
          return;
        }
        const writeFailureMarker = async (reason?: "missing-run-record" | "retention-exceeded") =>
          writeJsonAtomic(path.join(path.dirname(envelopePath), "artifact-failed.json"), {
            version: 1,
            diagnosticId: envelope.diagnosticId,
            failedAt: new Date(dependencies.now()).toISOString(),
            ...(reason ? { reason } : {}),
          }, true).then(() => true, () => false);
        if (envelopeAgeMs >= dependencies.retentionMs) {
          retryScheduled = !(await writeFailureMarker("retention-exceeded"));
          if (retryScheduled) {
            schedulePlanArtifactRetry(envelopePath, attempt, dependencies.slowRetryMs, dependencies);
          }
          return;
        }
        if (error instanceof PlanArtifactPersistenceError && error.reason === "missing") {
          if (envelopeAgeMs >= dependencies.missingRunGraceMs) {
            retryScheduled = !(await writeFailureMarker("missing-run-record"));
            if (retryScheduled) {
              schedulePlanArtifactRetry(envelopePath, attempt, dependencies.slowRetryMs, dependencies);
            }
            return;
          }
          retryScheduled = true;
          schedulePlanArtifactRetry(
            envelopePath,
            retryDelayMs === undefined ? attempt : attempt + 1,
            retryDelayMs ?? dependencies.slowRetryMs,
            dependencies,
          );
          return;
        }
        if (error instanceof PlanArtifactPersistenceError && error.reason === "unavailable") {
          retryScheduled = true;
          schedulePlanArtifactRetry(
            envelopePath,
            retryDelayMs === undefined ? attempt : attempt + 1,
            retryDelayMs ?? dependencies.slowRetryMs,
            dependencies,
          );
          return;
        }
        if (retryDelayMs === undefined) {
          const failureRecorded = await dependencies.updateArtifact({
            diagnosticId: envelope.diagnosticId,
            status: "failed",
          });
          if (failureRecorded === "updated") {
            const markerWritten = await writeFailureMarker();
            if (markerWritten) return;
          }
          retryScheduled = true;
          schedulePlanArtifactRetry(envelopePath, attempt, dependencies.slowRetryMs, dependencies);
          return;
        }
        schedulePlanArtifactRetry(envelopePath, attempt + 1, retryDelayMs, dependencies);
      })
      .finally(() => {
        artifactFinalizerState.running -= 1;
        if (!retryScheduled) artifactFinalizerState.queued.delete(envelopePath);
        pumpArtifactFinalizers();
        settleArtifactFinalizerIdle();
      });
  }
  settleArtifactFinalizerIdle();
}

function enqueuePlanArtifactEnvelope(
  envelopePath: string,
  dependencies: PlanArtifactFinalizerDependencies = defaultPlanArtifactFinalizerDependencies,
) {
  const resolved = path.resolve(/* turbopackIgnore: true */ envelopePath);
  if (artifactFinalizerState.queued.has(resolved)) return;
  artifactFinalizerState.queued.add(resolved);
  artifactFinalizerState.queue.push({ envelopePath: resolved, attempt: 0, dependencies });
  pumpArtifactFinalizers();
}

export function enqueuePlanArtifactFinalization(result: PlanApiResponse): boolean {
  if (!result.artifactEnvelopePath) return false;
  enqueuePlanArtifactEnvelope(result.artifactEnvelopePath);
  return true;
}

export async function resumePendingPlanArtifactFinalizations(
  dependencyOverrides: Partial<PlanArtifactFinalizerDependencies> = {},
): Promise<number> {
  const dependencies = { ...defaultPlanArtifactFinalizerDependencies, ...dependencyOverrides };
  await mkdir(cliRunRoot, { recursive: true });
  const entries = await readdir(cliRunRoot, { withFileTypes: true });
  let resumed = 0;
  const directories = entries.filter((entry) => entry.isDirectory());
  const batchSize = 64;
  for (let offset = 0; offset < directories.length; offset += batchSize) {
    const envelopePaths = await Promise.all(
      directories.slice(offset, offset + batchSize).map(async (entry) => {
        const runDir = path.join(cliRunRoot, entry.name);
        const files = new Set(await readdir(runDir).catch(() => []));
        if (
          !files.has("run-envelope.json")
          || files.has("artifact-finalized.json")
          || files.has("artifact-failed.json")
        ) return null;
        return path.join(runDir, "run-envelope.json");
      }),
    );
    for (const envelopePath of envelopePaths) {
      if (!envelopePath) continue;
      enqueuePlanArtifactEnvelope(envelopePath, dependencies);
      resumed += 1;
    }
  }
  return resumed;
}

export async function waitForPlanArtifactFinalizers(timeoutMs: number): Promise<boolean> {
  if (
    artifactFinalizerState.running === 0
    && artifactFinalizerState.queue.length === 0
    && artifactFinalizerState.retryTimers.size === 0
  ) return true;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let resolveIdle: (() => void) | undefined;
  const idle = new Promise<true>((resolve) => {
    resolveIdle = () => resolve(true);
    artifactFinalizerState.idleWaiters.add(resolveIdle);
  });
  const expired = new Promise<false>((resolve) => {
    timeout = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
  });
  const result = await Promise.race([idle, expired]);
  if (timeout) clearTimeout(timeout);
  if (resolveIdle) artifactFinalizerState.idleWaiters.delete(resolveIdle);
  return result;
}

export async function runPlan(
  body: unknown,
  options: { serveLane?: number; deferArtifacts?: boolean } = {},
): Promise<PlanApiResponse> {
  let runDir = "";
  let ephemeralRunDir = "";
  let resultPath = "";
  let artifactEnvelopePath = "";
  let runId = "";
  let runDataOwnerTag: string | null = null;
  let deferArtifacts = false;
  let solverStartedAt: string | undefined;
  let solverFinishedAt: string | undefined;
  let solver: SolverObservation | undefined;
  let fallbackUsed = false;
  const solverAttempts: NonNullable<PlanApiResponse["solverAttempts"]> = [];
  const startedAt = new Date().toISOString();
  const start = performance.now();

  try {
    // Record retention is housekeeping. A corrupt legacy record must not block planning.
    void maintainPrivateRecordsIfDue().catch(() => undefined);
    assertPlanBody(body);
    runDataOwnerTag = body.dataOwnerTag ?? null;

    runId = randomUUID();
    runDir = path.join(cliRunRoot, makeStampedDirName(startedAt, body.sourceName, runId));
    try {
      await mkdir(runDir, { recursive: true });
    } catch {
      ephemeralRunDir = await mkdtemp(path.join(tmpdir(), "arknights-infra-run-"));
      runDir = ephemeralRunDir;
    }
    // A temporary fallback directory is deleted before returning, so it cannot
    // provide a durable envelope for the asynchronous finalizer.
    deferArtifacts = Boolean(options.deferArtifacts && !ephemeralRunDir);
    if (body.dataOwnerTag) {
      // Keep the ownership marker compatible with the previous release so a
      // rollback can still delete a pending deferred Skland artifact.
      await writeJsonAtomic(path.join(runDir, "owner.json"), {
        version: 1,
        ownerTag: body.dataOwnerTag,
        diagnosticId: runId,
        sourceName: body.sourceName ?? null,
        createdAt: startedAt,
      }, true);
    }

    const layoutPath = path.join(runDir, "layout.json");
    const operboxPath = path.join(runDir, "operbox.json");
    const profilePath = path.join(runDir, "profile.json");
    const maaPath = path.join(runDir, "maa.json");
    const shiftsDir = path.join(runDir, "shifts");
    const debugBundlePath = path.join(runDir, "debug-bundle.json");
    const stdoutPath = path.join(runDir, "stdout.txt");
    const stderrPath = path.join(runDir, "stderr.txt");
    const commandPath = path.join(runDir, "command.txt");
    const serveRequestPath = path.join(runDir, "serve-request.json");
    const serveRequestLinePath = path.join(runDir, "serve-request.jsonl");
    const serveResponsePath = path.join(runDir, "serve-response.json");
    const reproductionPath = path.join(runDir, "reproduction.json");
    resultPath = path.join(runDir, "result.json");
    artifactEnvelopePath = path.join(runDir, "run-envelope.json");

    // Keep the cache identity and actual solver request on the exact same effective input.
    body.operbox = normalizeSolverOperbox(body.operbox);
    if (body.operbox.length === 0) {
      throw new PublicApiError("AIC-BOX-1101", {
        fieldErrors: [{
          path: "operbox",
          code: "invalid_operbox",
          message: "干员数据中没有已拥有的干员，无法生成排班。",
        }],
      });
    }

    await writeJson(layoutPath, body.layout);
    await writeJson(operboxPath, body.operbox);
    await writeJson(reproductionPath, {
      version: 1,
      diagnosticId: runId,
      sourceName: body.sourceName ?? null,
      rotation: body.rotation,
      fiammettaEnabled: body.fiammettaEnable ?? true,
    });

    const fallbackConfig=verifySolverFallbackConfig();
    let cliPath = fallbackConfig ? "" : resolveCliPath();
    const serveLane = options.serveLane ?? 0;
    const serveClient = getPlanServeClient(serveLane);
    const planCompute = fallbackConfig ? null : await getPlanServeCapability(serveLane, serveClient);
    if(planCompute) solver = createSolverObservation(planCompute, new Date().toISOString());
    let serveResult: ServeResult;
    let profileJson: unknown;
    let maaJson: unknown;
    let trainingRoomJson: unknown;
    let trainingAdviceJson: unknown;
    let rotationSource: unknown;
    let serveShifts: unknown[] = [];
    let shiftFiles: string[] = [];
    let shiftReadErrors: string[] = [];
    let shiftsPath: string | undefined;
    let responseValidationError: string | undefined;
    let solverDurationMs: number | undefined;
    let combinedReportedDuration: number | undefined;

    if (fallbackConfig) {
      const params=createPlanComputeParams({layout:body.layout,operbox:body.operbox,sourceName:body.sourceName,
        rotation:body.rotation,fiammettaEnable:body.fiammettaEnable});
      const captures: Array<Record<string,unknown>>=[];
      const preserveAttempt=async(name:string,capture:Record<string,unknown>)=>{
        try {await writeJsonAtomic(path.join(runDir,name),capture,true);}
        catch(error) {
          console.error(JSON.stringify({...makeDiagnostic({code:"AIC-PLAN-3004",status:500,route:"solver/attempt-artifact",requestId:runId,
            durationMs:0,error}),event:"solver_attempt_artifact_write_failed"}));
        }
      };
      const reportedDurations: Array<number | undefined>=[];
      const attempt=async(engine:"primary"|"fallback",budgetMs:number)=>{
        const client=engine==="primary" ? serveClient : getFallbackServeClient(serveLane,fallbackConfig);
        const attemptStarted=performance.now();
        const attemptStartedAt=new Date().toISOString();
        solverStartedAt ??= attemptStartedAt;
        let observation:SolverObservation|undefined;
        let wire:ServeResult|undefined;
        let errorMessage:string|undefined;
        let failed=false;
        try {
          return await withinSolverDeadline(async()=>{
            cliPath=engine==="primary" ? resolveCliPath() : fallbackConfig.cliPath;
            const capability=engine==="primary" ? await getPlanServeCapability(serveLane,client)
              : inspectPlanComputeCapability((await client.ping()).response);
            const ready=inspectSolverDeploymentReadiness(capability,engine==="primary" ? expectedSolverSha256ForSelectedCli() : fallbackConfig.sha256);
            if(!ready.ready) throw new Error(`Solver protocol or identity rejected: ${ready.reason}`);
            observation=createSolverObservation(capability,new Date().toISOString());
            solver=observation;
            wire=await client.send("plan.compute",params,{timeoutMs:budgetMs});
            if(wire.response.error || (isObject(wire.response.result) && wire.response.result.error)) {
              throw new Error(formatPlanFailure({layout:body.layout,response:wire.response,stderr:wire.stderr}));
            }
            const payload=parsePlanComputePayload(wire.response);
            if(!payload) throw new Error(formatPlanFailure({layout:body.layout,response:wire.response,stderr:wire.stderr}));
            assertCompleteSolverOutput(payload,body.rotation);
            // Exercise the same public contract before choosing either engine's output.
            toPublicPlanData({success:true,profileJson:payload.profile as unknown as PlanApiResponse["profileJson"],
              maaJson:payload.maa as unknown as PlanApiResponse["maaJson"],rotationJson:payload.rotation as unknown as PlanApiResponse["rotationJson"],
              trainingRoomJson:payload.trainingRoom,trainingAdviceJson:payload.trainingAdvice},
            {layoutLabel:body.layout.template,sourceName:body.sourceName ?? "已导入的干员数据"},runId);
            return {wire,payload};
          },budgetMs,()=>client.stop("Solver attempt deadline exceeded."));
        } catch(error) {
          failed=true;
          errorMessage=(error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error)) || "Solver attempt failed.";
          throw error;
        } finally {
          solverFinishedAt=new Date().toISOString();
          const reported=wire?.response.elapsed_ms;
          reportedDurations.push(typeof reported==="number" && Number.isFinite(reported) && reported>=0 ? Math.round(reported) : undefined);
          const entry={engine,status:failed ? "failed" as const : "success" as const,durationMs:Math.round(performance.now()-attemptStarted),solver:observation,error:errorMessage};
          solverAttempts.push(entry);
          captures.push({...entry,startedAt:attemptStartedAt,finishedAt:solverFinishedAt,cliPath,
            request:wire?.request ?? {method:"plan.compute",params},response:wire?.response ?? null,stdout:wire?.stdout ?? "",stderr:wire?.stderr ?? ""});
        }
      };
      try {
        const execution=await withSolverLane(serveLane,()=>runWithSolverFallback({budgetMs:timeoutMs,
          primary:budget=>attempt("primary",budget),fallback:async budget=>{
            fallbackUsed=true;
            try {return await attempt("fallback",budget);}
            finally {if(solverAttempts.at(-1)?.status==="failed") await getFallbackServeClient(serveLane,fallbackConfig).stopAndWait("Fallback failed; drain lane.");}
          },
          onPrimaryFailure:async error=>{
            // Preserve the first response before starting the second solver, including deferred runs.
            await preserveAttempt("primary-attempt.json",captures[0]);
            console.error(JSON.stringify({...makeDiagnostic({code:"AIC-PLAN-3004",status:502,route:"solver/plan/primary",requestId:runId,
              durationMs:solverAttempts[0]?.durationMs ?? 0,error,reason:solverAttempts[0]?.error}),event:"solver_primary_failed"}));
            await serveClient.stopAndWait("Primary failed; isolate fallback process.");
          }}));
        serveResult=execution.value.wire;
        const payload=execution.value.payload;
        profileJson=payload.profile;maaJson=payload.maa;trainingRoomJson=payload.trainingRoom;trainingAdviceJson=payload.trainingAdvice;
        rotationSource=payload.rotation;serveShifts=payload.rotation.shifts;
        if(reportedDurations.every(value=>value!==undefined)) combinedReportedDuration=reportedDurations.reduce<number>((sum,value)=>sum+(value ?? 0),0);
        if(!deferArtifacts && profileJson) await writeJson(profilePath,profileJson);
        if(!deferArtifacts && maaJson) await writeJson(maaPath,maaJson);
      } finally {
        if(solverAttempts[0]?.status==="failed") {
          if(captures[1]) await preserveAttempt("fallback-attempt.json",captures[1]);
          const fallbackAttempt=solverAttempts[1];
          const diagnostic=makeDiagnostic({code:"AIC-PLAN-3004",status:502,route:"solver/plan/primary",requestId:runId,diagnosticId:runId,
            durationMs:solverAttempts.reduce((sum,row)=>sum+row.durationMs,0),reason:solverAttempts[0].error,
            fields:[{path:"primary.solver",code:solverAttempts[0].solver?.solver_executable_sha256 ?? "unknown",message:"primary"},
              {path:"fallback.solver",code:fallbackConfig.sha256,message:"v2"},
              {path:"fallback.outcome",code:fallbackAttempt?.status==="success" ? "recovered" : fallbackAttempt ? "failed" : "skipped",
                message:fallbackAttempt?.error ?? (fallbackAttempt?.status==="success" ? "Recovered with v2; final task is successful." : "No fallback result.")} ]});
          persistDiagnostic(diagnostic);
          console.info(JSON.stringify({...diagnostic,event:"solver_fallback_completed"}));
        }
      }
    } else if (planCompute?.supported) {
      solverStartedAt = new Date().toISOString();
      try {
        serveResult = await serveClient.send("plan.compute", createPlanComputeParams({
          layout: body.layout,
          operbox: body.operbox,
          sourceName: body.sourceName,
          rotation: body.rotation,
          fiammettaEnable: body.fiammettaEnable,
        }));
      } finally {
        solverFinishedAt = new Date().toISOString();
      }

      let payload: ReturnType<typeof parsePlanComputePayload> = null;
      try {
        payload = parsePlanComputePayload(serveResult.response);
      } catch (error) {
        responseValidationError = error instanceof Error ? error.message : String(error);
      }
      profileJson = payload?.profile;
      maaJson = payload?.maa;
      trainingRoomJson = payload?.trainingRoom;
      trainingAdviceJson = payload?.trainingAdvice;
      rotationSource = payload?.rotation;
      serveShifts = payload && Array.isArray(payload.rotation.shifts) ? payload.rotation.shifts : [];
      if (!deferArtifacts && profileJson) await writeJson(profilePath, profileJson);
      if (!deferArtifacts && maaJson) await writeJson(maaPath, maaJson);
    } else {
      solverStartedAt = new Date().toISOString();
      try {
        serveResult = await serveClient.send("plan", {
          layout: layoutPath,
          operbox: operboxPath,
          profile_out: profilePath,
          maa_out: maaPath,
          output_dir: shiftsDir,
          top: 20,
          rotation: body.rotation,
          maa_title: `${body.sourceName ?? "Arknights InfraCalc"} · ${String(body.layout.template ?? "layout")}`,
        });
      } finally {
        solverFinishedAt = new Date().toISOString();
      }

      profileJson = await readJsonIfExists(profilePath);
      maaJson = await readJsonIfExists(maaPath);
      const shiftRead = await readShiftFiles(shiftsDir);
      const responseResult = isObject(serveResult.response.result) ? serveResult.response.result : undefined;
      trainingAdviceJson = responseResult && typeof responseResult === "object"
        ? (responseResult as { training_advice?: unknown }).training_advice
        : undefined;
      rotationSource = responseResult;
      const responseShifts = responseResult && Array.isArray(responseResult.shifts) ? responseResult.shifts : [];
      serveShifts = responseShifts.length > 0 ? responseShifts : shiftRead.shifts;
      shiftFiles = shiftRead.files.map((file) => path.relative(repoRoot, file));
      shiftReadErrors = shiftRead.errors;
      shiftsPath = path.relative(repoRoot, shiftsDir);
    }

    const reportedSolverDuration = fallbackConfig ? combinedReportedDuration : serveResult.response.elapsed_ms;
    if (typeof reportedSolverDuration === "number" && Number.isFinite(reportedSolverDuration) && reportedSolverDuration >= 0) {
      solverDurationMs = Math.round(reportedSolverDuration);
    }

    const durationMs = Math.round(performance.now() - start);
    const command = `${cliPath} serve < ${path.relative(repoRoot, serveRequestLinePath)}`;
    if (!deferArtifacts) {
      await writeFile(commandPath, command, "utf-8");
      await writeJson(serveRequestPath, serveResult.request);
      await writeFile(serveRequestLinePath, `${JSON.stringify(serveResult.request)}\n`, "utf-8");
      await writeJson(serveResponsePath, serveResult.response);
    }

    const rotationJson = normalizeRotationResult({
      source: rotationSource,
      shifts: serveShifts,
      profile: profileJson,
      fallbackProfile: body.rotation,
    });
    if (!deferArtifacts) {
      await writeFile(stdoutPath, serveResult.stdout, "utf-8");
      await writeFile(stderrPath, serveResult.stderr, "utf-8");
    }

    const success = serveResult.response.ok === true && Boolean(profileJson) && Boolean(maaJson);
    const debugBundle: DebugBundle = {
      version: "beta-test-bundle-v2-next-serve",
      startedAt,
      durationMs,
      solverDurationMs,
      solverStartedAt,
      solverFinishedAt,
      cliPath,
      command,
      exitCode: success ? 0 : null,
      signal: null,
      inputSummary: {
        layoutRooms: Array.isArray(body.layout.rooms) ? body.layout.rooms.length : null,
        operboxCount: body.operbox.length,
        sourceName: body.sourceName ?? null,
      },
      layout: body.layout,
      operbox: body.operbox,
      profileJson: profileJson as DebugBundle["profileJson"],
      maaJson: maaJson as DebugBundle["maaJson"],
      rotationJson: rotationJson as DebugBundle["rotationJson"],
      solver,
      shiftFiles,
      shiftReadErrors,
      serveRequest: serveResult.request,
      serveResponse: serveResult.response,
      stdout: serveResult.stdout,
      stderr: serveResult.stderr,
      savedFiles: ephemeralRunDir ? undefined : {
        runDir: path.relative(repoRoot, runDir),
        layout: path.relative(repoRoot, layoutPath),
        operbox: path.relative(repoRoot, operboxPath),
        profile: profileJson ? path.relative(repoRoot, profilePath) : undefined,
        maa: maaJson ? path.relative(repoRoot, maaPath) : undefined,
        shifts: shiftsPath,
        debugBundle: path.relative(repoRoot, debugBundlePath),
        stdout: path.relative(repoRoot, stdoutPath),
        stderr: path.relative(repoRoot, stderrPath),
        command: path.relative(repoRoot, commandPath),
        serveRequest: path.relative(repoRoot, serveRequestPath),
        serveRequestLine: path.relative(repoRoot, serveRequestLinePath),
        serveResponse: path.relative(repoRoot, serveResponsePath),
        result: path.relative(repoRoot, resultPath),
      },
    };
    if (!deferArtifacts) await writeJson(debugBundlePath, debugBundle);

    const resultPayload: PlanApiResponse = {
      success,
      ...(fallbackConfig ? {fallbackUsed,solverAttempts} : {}),
      startedAt,
      durationMs,
      solverDurationMs,
      solverStartedAt,
      solverFinishedAt,
      cliPath,
      command,
      exitCode: success ? 0 : null,
      signal: null,
      stdout: serveResult.stdout,
      stderr: serveResult.stderr,
      profileJson: profileJson as PlanApiResponse["profileJson"],
      maaJson: maaJson as PlanApiResponse["maaJson"],
      trainingRoomJson: trainingRoomJson as PlanApiResponse["trainingRoomJson"],
      trainingAdviceJson: trainingAdviceJson as PlanApiResponse["trainingAdviceJson"],
      rotationJson: rotationJson as PlanApiResponse["rotationJson"],
      solver,
      debugBundle,
      runId,
      runPath: runDir,
      relativeRunPath: path.relative(repoRoot, runDir),
      resultPath,
      relativeResultPath: path.relative(repoRoot, resultPath),
      artifactEnvelopePath: deferArtifacts ? artifactEnvelopePath : undefined,
      relativeArtifactEnvelopePath: deferArtifacts ? path.relative(repoRoot, artifactEnvelopePath) : undefined,
      error: success
        ? undefined
        : responseValidationError ??
          formatPlanFailure({
            layout: body.layout,
            response: serveResult.response,
            stderr: serveResult.stderr,
          }),
    };
    if (deferArtifacts) {
      await writeJsonAtomic(artifactEnvelopePath, {
        version: "plan-run-envelope-v1",
        diagnosticId: runId,
        dataOwnerTag: body.dataOwnerTag ?? null,
        result: resultPayload,
      }, true);
    } else {
      await writeJson(resultPath, resultPayload);
    }

    return resultPayload;
  } catch (error) {
    // 显式的 API 校验错误（如空 box）直接透传，由路由映射为对应 HTTP 状态码
    if (error instanceof PublicApiError) throw error;
    const errorPayload: PlanApiResponse = {
      success: false,
      fallbackUsed,
      solverAttempts,
      startedAt,
      durationMs: Math.max(0, Math.round(performance.now() - start)),
      solverStartedAt,
      solverFinishedAt,
      solver,
      error: error instanceof Error ? error.message : String(error),
      runId: runId || undefined,
      runPath: runDir || undefined,
      relativeRunPath: runDir ? path.relative(repoRoot, runDir) : undefined,
      resultPath: resultPath || undefined,
      relativeResultPath: resultPath ? path.relative(repoRoot, resultPath) : undefined,
    };
    if (resultPath) {
      if (deferArtifacts && artifactEnvelopePath) {
        const deferredErrorPayload: PlanApiResponse = {
          ...errorPayload,
          artifactEnvelopePath,
          relativeArtifactEnvelopePath: path.relative(repoRoot, artifactEnvelopePath),
        };
        const envelopeWritten = await writeJsonAtomic(artifactEnvelopePath, {
          version: "plan-run-envelope-v1",
          diagnosticId: runId,
          dataOwnerTag: runDataOwnerTag,
          result: deferredErrorPayload,
        }, true).then(() => true, () => false);
        if (envelopeWritten) return deferredErrorPayload;
      } else {
        await writeJson(resultPath, errorPayload);
      }
    }
    return errorPayload;
  } finally {
    if (ephemeralRunDir) await rm(ephemeralRunDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function listOpsRecords() {
  const databaseReads = isBusinessDatabaseReadEnabled();
  const recordsPromise = (async () => {
    if (databaseReads) {
      try {
        const [feedbackRecords, runRecords] = await Promise.all([
          queryBusinessRecords({ kind: "feedback", limit: 100 }),
          queryBusinessRecords({ kind: "runs", limit: 100 }),
        ]);
        return { feedbackRecords, runRecords };
      } catch (error) {
        if (!isBusinessFileFallbackEnabled()) throw error;
      }
    }
    const [feedbackRecords, runRecords] = await Promise.all([
      listStoredRecords(feedbackRoot, "meta.json", "issue.json"),
      listStoredRecords(cliRunRoot, "result.json", "debug-bundle.json"),
    ]);
    return { feedbackRecords, runRecords };
  })();
  const [{ feedbackRecords, runRecords }, releases, health, storage] = await Promise.all([
    recordsPromise,
    listCliReleases(),
    getHealth(),
    getOpsStorageStats(),
  ]);
  const feedback = databaseReads && "items" in feedbackRecords
    ? feedbackRecords.items.map((data) => ({ id: "id" in data ? String(data.id) : "", data, ops: { status: "status" in data ? data.status : null, note: "adminNote" in data ? data.adminNote : null } }))
    : feedbackRecords;
  const runs = databaseReads && "items" in runRecords
    ? runRecords.items.map((data) => ({ id: "diagnosticId" in data ? String(data.diagnosticId) : "", data, ops: null }))
    : runRecords;
  return { feedback, runs, releases, health, storage, activeCli: readActiveCliPath() ?? null };
}

async function listStoredRecords(root: string, primary: string, fallback: string) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => b.name.localeCompare(a.name))
      .slice(0, 200)
      .map(async (entry) => {
        const dir = path.join(root, entry.name);
        const data = (await readJsonIfExists(path.join(dir, primary))) ?? (await readJsonIfExists(path.join(dir, fallback)));
        const ops = await readJsonIfExists(path.join(dir, "ops.json"));
        return { id: entry.name, data, ops };
      })
  );
}

async function directorySize(root: string): Promise<number> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const sizes = await Promise.all(entries.map(async (entry) => {
    const filePath = path.join(root, entry.name);
    return entry.isDirectory() ? directorySize(filePath) : stat(filePath).then((item) => item.size).catch(() => 0);
  }));
  return sizes.reduce((sum, size) => sum + size, 0);
}

async function getOpsStorageStats() {
  const [feedbackBytes, runBytes, releaseBytes] = await Promise.all([
    directorySize(feedbackRoot), directorySize(cliRunRoot), directorySize(cliReleaseRoot),
  ]);
  return { feedbackBytes, runBytes, releaseBytes, totalBytes: feedbackBytes + runBytes + releaseBytes };
}

export async function updateFeedbackOps(id: string, status: string, note: string, expectedUpdatedAt?: string) {
  if (!/^[\w.-]+$/.test(id)) throw new Error("记录 ID 非法。");
  const normalizedStatus = legacyAdminFeedbackStatus(status);
  if (!normalizedStatus) throw new Error("状态非法。");
  if (isBusinessDatabaseReadEnabled()) {
    const updated = await updateFeedbackRecord({
      feedbackId: id,
      status: normalizedStatus,
      note,
      expectedUpdatedAt,
    });
    if (updated || !isBusinessFileFallbackEnabled()) {
      if (!updated) throw new Error("记录不存在。");
      return updated;
    }
  }
  const dir = path.join(feedbackRoot, id);
  await stat(dir);
  const value = { status: normalizedStatus, note: note.trim().slice(0, 2000), updatedAt: new Date().toISOString() };
  await writeJson(path.join(dir, "ops.json"), value);
  return value;
}

export async function readOpsRecord(kind: "feedback" | "runs", id: string) {
  if (!/^[\w.-]+$/.test(id)) throw new Error("记录 ID 非法。");
  const root = kind === "feedback" ? feedbackRoot : cliRunRoot;
  const dir = path.join(root, id);
  const names = kind === "feedback"
    ? ["meta.json", "issue.json", "debug-bundle.json"]
    : ["result.json", "debug-bundle.json", "stderr.txt", "stdout.txt"];
  const files = await Promise.all(names.map(async (name) => [name, await readFile(path.join(dir, name), "utf-8").catch(() => null)]));
  if (files.every(([, value]) => value === null)) throw new Error("记录不存在。");
  return Object.fromEntries(files);
}

async function listCliReleases() {
  const entries = await readdir(/* turbopackIgnore: true */ cliReleaseRoot, { withFileTypes: true }).catch(() => []);
  return Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const metadata = await readJsonIfExists(path.join(cliReleaseRoot, entry.name, "metadata.json"));
    return { id: entry.name, metadata };
  })).then((items) => items.sort((a, b) => b.id.localeCompare(a.id)));
}

export async function uploadCliRelease(file: File, label: string) {
  if (!file.size || file.size > 150 * 1024 * 1024) throw new Error("CLI 文件必须在 1B 到 150MB 之间。");
  const bytes = Buffer.from(await file.arrayBuffer());
  const isElf = bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46;
  const isPe = bytes[0] === 0x4d && bytes[1] === 0x5a;
  if (!isElf && !isPe) throw new Error("仅接受 ELF 或 Windows PE 可执行文件。");
  const platform = isPe ? "windows" : "linux";
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const uploadedAt = new Date().toISOString();
  const id = `${uploadedAt.replace(/[:.]/g, "-")}_${sha256.slice(0, 12)}`;
  const releaseDir = path.join(cliReleaseRoot, id);
  const binaryPath = path.join(releaseDir, isPe ? "infra-cli.exe" : "infra-cli");
  await mkdir(releaseDir, { recursive: false });
  await writeFile(binaryPath, bytes, { flag: "wx" });
  if (!isPe) await chmod(binaryPath, 0o750);
  const metadata = { id, label: label.trim().slice(0, 80) || file.name, originalName: file.name, platform, size: file.size, sha256, uploadedAt, path: binaryPath };
  await writeJson(path.join(releaseDir, "metadata.json"), metadata);
  return metadata;
}

export async function publishCliRelease(file: File, label: string) {
  const metadata = await uploadCliRelease(file, label);
  const active = await activateCliRelease(metadata.id);
  return { ...metadata, active };
}

export async function activateCliRelease(id: string) {
  if (!/^[\w.-]+$/.test(id)) throw new Error("Release ID 非法。");
  const metadata = await readJsonIfExists(path.join(cliReleaseRoot, id, "metadata.json"));
  if (!isObject(metadata) || typeof metadata.path !== "string") throw new Error("Release 不存在。");
  const candidate = describeCliCandidate(metadata.path);
  if (!candidate.exists || !candidate.compatible) throw new Error(candidate.reason || "CLI 不可用。");
  await stat(metadata.path);
  await mkdir(storageRoot, { recursive: true });
  const temp = `${activeCliPath}.${randomUUID()}.tmp`;
  await writeJson(temp, { releaseId: id, path: metadata.path, activatedAt: new Date().toISOString() });
  await rename(temp, activeCliPath);
  stopInfraServeClients("CLI 版本已切换，等待下次请求重启。");
  return { releaseId: id, path: metadata.path };
}

export async function runOpsSmokeTest() {
  const sample = await getSampleOperbox();
  const layout = JSON.parse(await readFile(path.join(repoRoot, "src", "layouts", "243.json"), "utf-8")) as BaseBlueprint;
  return runPlan({
    layout,
    operbox: sample.operbox as OperBoxEntry[],
    sourceName: "ops-smoke-243-full-e2",
    rotation: "abc_12_6_6",
  });
}
