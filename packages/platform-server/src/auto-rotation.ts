import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  isAutoRotationHours,
  type AutoRotationHours,
  type AutoRotationResult,
  type AutoRotationState,
} from "@riic/arknights-domain/auto-rotation";
import type { BaseBlueprint, OperBoxEntry, RoomEfficiency, RoomKind } from "@riic/arknights-domain/types";
import { registerProcessCleanup } from "./process-cleanup.ts";
import { withAbortableSolverLane } from "./solver-fallback.ts";

const MAX_STDOUT_BYTES = 4 * 1024 * 1024;
const MAX_STDERR_BYTES = 1024 * 1024;
const PRIVATE_PATH_PATTERN = /(?:[A-Za-z]:[\\/]|\/(?:home|Users|workspace|tmp|var|etc)\/)/;
const AUTO_ROOM_KINDS = new Set<RoomKind>([
  "control_center",
  "trade_post",
  "factory",
  "power_plant",
  "office",
  "meeting_room",
  "recycle",
]);

export type AutoRotationCliFailureReason =
  | "invalid_input"
  | "runtime_unavailable"
  | "spawn_failed"
  | "timeout"
  | "aborted"
  | "output_too_large"
  | "process_failed"
  | "invalid_output";

export class AutoRotationCliError extends Error {
  readonly reason: AutoRotationCliFailureReason;

  constructor(reason: AutoRotationCliFailureReason) {
    const messages: Record<AutoRotationCliFailureReason, string> = {
      invalid_input: "Automatic rotation input is invalid.",
      runtime_unavailable: "Automatic rotation runtime data is unavailable.",
      spawn_failed: "Automatic rotation solver could not be started.",
      timeout: "Automatic rotation solver timed out.",
      aborted: "Automatic rotation request was cancelled.",
      output_too_large: "Automatic rotation solver output exceeded the allowed size.",
      process_failed: "Automatic rotation solver failed.",
      invalid_output: "Automatic rotation solver returned an invalid result.",
    };
    super(messages[reason]);
    this.name = "AutoRotationCliError";
    this.reason = reason;
  }
}

export interface RunAutoRotationCliInput {
  layout: BaseBlueprint;
  operbox: OperBoxEntry[];
  hours: AutoRotationHours;
  fiammettaEnable?: boolean;
}

export interface RunAutoRotationCliOptions {
  cliPath: string;
  runtimeDataDir: string | null;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Test-only prefix placed before the fixed infra-cli arguments. */
  commandPrefix?: readonly string[];
}

export async function withAutoRotationLane<T>(
  lane: number,
  requestSignal: AbortSignal | undefined,
  deadlineMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    throw new AutoRotationCliError("invalid_input");
  }
  const controller = new AbortController();
  let deadlineExpired = false;
  const abortFromRequest = () => controller.abort();
  if (requestSignal?.aborted) abortFromRequest();
  else requestSignal?.addEventListener("abort", abortFromRequest, { once: true });
  const timer = setTimeout(() => {
    deadlineExpired = true;
    controller.abort();
  }, deadlineMs);
  timer.unref?.();
  try {
    return await withAbortableSolverLane(
      lane,
      controller.signal,
      () => run(controller.signal),
      () => new AutoRotationCliError(deadlineExpired ? "timeout" : "aborted"),
    );
  } finally {
    clearTimeout(timer);
    requestSignal?.removeEventListener("abort", abortFromRequest);
  }
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new AutoRotationCliError("invalid_output");
  }
  return value as JsonRecord;
}

function string(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 160) {
    throw new AutoRotationCliError("invalid_output");
  }
  return value;
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new AutoRotationCliError("invalid_output");
  }
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  return value === undefined || value === null ? undefined : number(value);
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new AutoRotationCliError("invalid_output");
  return value;
}

function operatorNames(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 10) throw new AutoRotationCliError("invalid_output");
  return value.map((entry) => string(record(entry).name));
}

function roomKind(value: unknown): RoomKind {
  const kind = string(value) as RoomKind;
  if (!AUTO_ROOM_KINDS.has(kind)) throw new AutoRotationCliError("invalid_output");
  return kind;
}

function projectEfficiency(kind: RoomKind, value: unknown): RoomEfficiency | undefined {
  if (value === undefined || value === null) return undefined;
  const efficiency = record(value);
  const read = (key: string) => optionalNumber(efficiency[key]);
  if (kind === "trade_post") {
    const total = read("trade_total_efficiency");
    const base = read("trade_base_efficiency");
    const occupancy = read("trade_occupancy_efficiency") ?? 0;
    const global = read("trade_control_efficiency") ?? 0;
    const order = read("trade_unit_output_multiplier") || 1;
    const gold = read("trade_equivalent_gold_efficiency") ?? 0;
    return {
      ...(total === undefined ? {} : { final_efficiency: total * order, total_efficiency: read("trade_paper_efficiency") ?? total }),
      order_multiplier: order,
      ...(base === undefined || total === undefined ? {} : {
        base_efficiency: base,
        equivalent_efficiency: total - 1 - occupancy - global,
        global_efficiency: global,
      }),
      trade_equivalent_efficiency: read("trade_equivalent_trade_efficiency"),
      ...(read("trade_skill_efficiency") === undefined ? {} : { trade_skill_pct: read("trade_skill_efficiency")! * 100 }),
      gold_equivalent_efficiency: gold,
      gold_output_multiplier: total && total > 0 ? gold / total : 0,
    };
  }
  if (kind === "factory") {
    const total = read("manufacture_total_efficiency");
    const base = read("manufacture_base_efficiency");
    return {
      ...(total === undefined ? {} : { final_efficiency: total, total_efficiency: total }),
      order_multiplier: 1,
      ...(base === undefined ? {} : {
        base_efficiency: base,
        equivalent_efficiency: read("manufacture_skill_efficiency") ?? 0,
        global_efficiency: read("manufacture_global_efficiency") ?? 0,
      }),
      manu_storage_limit: read("manufacture_storage_limit"),
    };
  }
  return undefined;
}

function recycleEfficiency(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  return optionalNumber(record(value).total_efficiency);
}

function projectState(kind: RoomKind, value: unknown): AutoRotationState {
  const state = record(value);
  const missingSeats = number(state.missing_seats);
  if (!Number.isInteger(missingSeats) || missingSeats < 0) throw new AutoRotationCliError("invalid_output");
  const complete = boolean(state.complete);
  if (complete !== (missingSeats === 0)) throw new AutoRotationCliError("invalid_output");
  const firstRedFace = state.first_red_face === null || state.first_red_face === undefined
    ? undefined
    : string(state.first_red_face);
  const efficiency = projectEfficiency(kind, state.efficiency);
  const snapshot = state.efficiency == null ? null : record(state.efficiency);
  const productionPerDay = snapshot === null || (kind !== "trade_post" && kind !== "factory") ? undefined : optionalNumber(snapshot[kind === "trade_post" ? "trade_output_per_day" : "manufacture_output_per_day"]);
  return {
    operators: operatorNames(state.operators),
    evaluationHours: number(state.evaluation_hours),
    missingSeats,
    complete,
    ...(efficiency === undefined ? {} : { efficiency }),
    ...(efficiency?.final_efficiency === undefined ? {} : { productionEfficiency: efficiency.final_efficiency }),
    ...(productionPerDay === undefined ? {} : { productionPerDay }),
    ...(optionalNumber(state.power_charge_efficiency) === undefined
      ? {}
      : { powerChargeEfficiency: optionalNumber(state.power_charge_efficiency) }),
    ...(optionalNumber(state.support_speed_bonus_pct) === undefined
      ? {}
      : { supportSpeedBonusPct: optionalNumber(state.support_speed_bonus_pct) }),
    ...(recycleEfficiency(state.recycle_efficiency) === undefined
      ? {}
      : { recycleEfficiency: recycleEfficiency(state.recycle_efficiency) }),
    ...(firstRedFace === undefined ? {} : { firstRedFace }),
  };
}

function sanitizeWarning(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new AutoRotationCliError("invalid_output");
  if (PRIVATE_PATH_PATTERN.test(value)) return "求解器返回了已隐藏路径的诊断信息。";
  return value.slice(0, 500);
}

export function projectAutoRotationReport(
  value: unknown,
  hours: AutoRotationHours,
  durationMs: number,
  diagnosticId: string,
): AutoRotationResult {
  const report = record(value);
  if (report.mode !== "auto_rotation") throw new AutoRotationCliError("invalid_output");
  const reportedHours = record(report.timing).shift_hours;
  if (!isAutoRotationHours(reportedHours) || reportedHours[0] !== hours[0] || reportedHours[1] !== hours[1]) {
    throw new AutoRotationCliError("invalid_output");
  }
  if (!Array.isArray(report.rooms) || report.rooms.length < 1 || report.rooms.length > 64) {
    throw new AutoRotationCliError("invalid_output");
  }
  const rooms = report.rooms.map((value) => {
    const room = record(value);
    const kind = roomKind(room.facility);
    return {
      roomId: string(room.room_id),
      kind,
      main: projectState(kind, room.main),
      backup: projectState(kind, room.backup),
    };
  });
  if (!Array.isArray(report.constant_dorm_support) || report.constant_dorm_support.length > 5) {
    throw new AutoRotationCliError("invalid_output");
  }
  const dormSupport = report.constant_dorm_support.map((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2) throw new AutoRotationCliError("invalid_output");
    return { roomId: string(entry[0]), operators: operatorNames(entry[1]) };
  });
  const rawFiammetta = report.fiammetta === undefined || report.fiammetta === null
    ? null
    : record(report.fiammetta);
  const fiammetta = rawFiammetta === null ? null : {
    enabled: boolean(rawFiammetta.enabled),
    available: boolean(rawFiammetta.available),
    targets: (() => {
      if (!Array.isArray(rawFiammetta.targets) || rawFiammetta.targets.length > 20) {
        throw new AutoRotationCliError("invalid_output");
      }
      return rawFiammetta.targets.map((value) => {
        const target = record(value);
        return { target: string(target.target), roomId: string(target.room_id) };
      });
    })(),
  };
  if (!Array.isArray(report.warnings) || report.warnings.length > 128) {
    throw new AutoRotationCliError("invalid_output");
  }
  const complete = boolean(report.complete);
  if (complete !== rooms.every((room) => room.main.complete && room.backup.complete)) {
    throw new AutoRotationCliError("invalid_output");
  }
  return {
    mode: "auto",
    hours: [...hours],
    complete,
    rooms,
    dormSupport,
    fiammetta,
    warnings: report.warnings.map(sanitizeWarning),
    durationMs: Math.max(0, Math.round(durationMs)),
    diagnosticId,
  };
}

async function executeCli(
  cliPath: string,
  args: readonly string[],
  options: Pick<RunAutoRotationCliOptions, "runtimeDataDir" | "timeoutMs" | "signal" | "commandPrefix">,
): Promise<string> {
  const runtimeDataDir = options.runtimeDataDir;
  if (options.signal?.aborted) throw new AutoRotationCliError("aborted");
  const environment = { ...process.env };
  const hasAutoDefaults = runtimeDataDir
    && existsSync(path.join(runtimeDataDir, "fixtures", "243", "layout.json"))
    && existsSync(path.join(runtimeDataDir, "fixtures", "243", "operbox_full_e2.json"));
  if (hasAutoDefaults) environment.ARKNIGHTS_INFRA_DATA_DIR = runtimeDataDir;
  else if (runtimeDataDir) {
    const resolvedRuntimeDataDir = path.resolve(runtimeDataDir);
    const cliDirectory = path.dirname(path.resolve(cliPath));
    const nativeRuntimeRoots = [
      path.join(cliDirectory, "data"),
      path.join(path.dirname(cliDirectory), "data"),
    ].map((candidate) => path.resolve(candidate));
    if (!nativeRuntimeRoots.includes(resolvedRuntimeDataDir)) {
      throw new AutoRotationCliError("runtime_unavailable");
    }
    delete environment.ARKNIGHTS_INFRA_DATA_DIR;
  } else delete environment.ARKNIGHTS_INFRA_DATA_DIR;
  return await new Promise<string>((resolve, reject) => {
    let stdout = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let termination: AutoRotationCliFailureReason | null = null;
    let settled = false;
    const child = spawn(cliPath, [...(options.commandPrefix ?? []), ...args], {
      cwd: path.dirname(cliPath),
      env: environment,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"] as const,
    });
    const unregisterProcessCleanup = registerProcessCleanup(process, () => {
      if (!child.killed) child.kill();
    });
    const finish = (error?: AutoRotationCliError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      unregisterProcessCleanup();
      if (error) reject(error);
      else resolve(stdout);
    };
    const stop = (reason: AutoRotationCliFailureReason) => {
      if (termination) return;
      termination = reason;
      child.kill();
    };
    const abort = () => stop("aborted");
    const timer = setTimeout(() => stop("timeout"), options.timeoutMs);
    timer.unref?.();
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutBytes += Buffer.byteLength(chunk);
      if (stdoutBytes > MAX_STDOUT_BYTES) stop("output_too_large");
      else stdout += chunk;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > MAX_STDERR_BYTES) stop("output_too_large");
    });
    child.on("error", () => finish(new AutoRotationCliError("spawn_failed")));
    child.on("close", (code) => {
      if (termination) return finish(new AutoRotationCliError(termination));
      if (code !== 0) return finish(new AutoRotationCliError("process_failed"));
      finish();
    });
  });
}

export async function runAutoRotationCli(
  input: RunAutoRotationCliInput,
  options: RunAutoRotationCliOptions,
): Promise<AutoRotationResult> {
  if (!input.layout || !Array.isArray(input.operbox) || !input.operbox.length || !isAutoRotationHours(input.hours)) {
    throw new AutoRotationCliError("invalid_input");
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new AutoRotationCliError("invalid_input");
  }
  const diagnosticId = randomUUID();
  const startedAt = performance.now();
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "riic-auto-rotation-"));
  try {
    const layoutPath = path.join(temporaryRoot, "layout.json");
    const operboxPath = path.join(temporaryRoot, "operbox.json");
    await Promise.all([
      writeFile(layoutPath, JSON.stringify(input.layout), "utf8"),
      writeFile(operboxPath, JSON.stringify(input.operbox), "utf8"),
    ]);
    const args = [
      "plan",
      "--layout", layoutPath,
      "--operbox", operboxPath,
      "--rotation", `auto@${input.hours[0]}/${input.hours[1]}`,
      "--json",
      "--assert-invariants",
      ...(input.fiammettaEnable === false ? ["--no-fiammetta"] : []),
    ];
    const stdout = await executeCli(options.cliPath, args, options);
    let report: unknown;
    try {
      report = JSON.parse(stdout);
    } catch {
      throw new AutoRotationCliError("invalid_output");
    }
    return projectAutoRotationReport(report, input.hours, performance.now() - startedAt, diagnosticId);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
