import { createHash } from "node:crypto";
import { appendFileSync, closeSync, constants, lstatSync, mkdirSync, openSync, realpathSync } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { DiagnosticCategory, DiagnosticRecord, DiagnosticReport } from "../diagnostics.ts";
import { diagnosticText } from "./diagnostic-text.ts";
import { isPrivateStorageChild, isSafePrivateStorageRoot } from "./private-storage.ts";

export function diagnosticCategory(code: string, status: number): DiagnosticCategory {
  if (code === "AIC-DATA-8001" || code === "AIC-AUTH-2005") return "consent";
  if (status === 429 || code === "AIC-PLAN-3005") return "rate_limit";
  if (status === 401 || status === 403 || code.startsWith("AIC-AUTH-")) return "authentication";
  if (status === 404) return "not_found";
  if (status === 400 || status === 413 || status === 422) return "validation";
  if (code.startsWith("AIC-PLAN-")) return "solver";
  return "fault";
}

/** Never retain query parameters, SQL bindings, request bodies or credential values. */
export function diagnosticSummary(value: unknown): string {
  const raw = typeof value === "string" ? value.slice(0, 4096) : "";
  if (/failed query:|\b(?:select|insert into|update|delete from)\b[\s\S]*\b(?:from|values|where|set)\b/i.test(raw)) return "database_query_failed";
  return (diagnosticText(raw
    .replace(/\b(?:cred|token|userId|accountId|email)\b["']?\s*[:=]\s*(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi, "[redacted]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(?:https?|postgres(?:ql)?):\/\/\S+/gi, "[url]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\{[\s\S]*\}/g, "[object]")
    .replace(/[\r\n\t]+/g, " ")) ?? "").slice(0, 600);
}

function identifier(value: unknown, fallback = "unknown"): string {
  return typeof value === "string" && /^[A-Za-z0-9_.:[\]/-]{1,120}$/.test(value) ? value : fallback;
}

export function makeDiagnostic(input: {
  code: string; status: number; route: string; requestId: string; durationMs: number;
  error?: unknown; reason?: unknown; fields?: Array<{path: string; code: string; message: string}>;
  request?: Request; diagnosticId?: string;
}, now = new Date()): DiagnosticRecord {
  const causes: string[] = [];
  const visited = new Set<unknown>();
  let error = input.error;
  for (let i = 0; i < 4 && error instanceof Error && !visited.has(error); i++) {
    visited.add(error);
    const errorCode = identifier((error as Error & {code?: unknown}).code, "");
    causes.push(`${identifier(error.name)}${errorCode ? ` (${errorCode})` : ""}: ${diagnosticSummary(error.message)}`);
    error = error.cause;
  }
  const fields = (input.fields ?? []).slice(0, 8).map(field => ({
    path: identifier(field.path), code: identifier(field.code), message: diagnosticSummary(field.message),
  }));
  const reason = diagnosticSummary(input.reason) || fields[0]?.message || causes.at(-1) || input.code;
  const route = identifier(input.route.split("?")[0].replace(
    /(\/(?:tasks|saved-plans|plans|users|feedback|plan-runs|accounts|skill-annotations)\/)[^/]+/g,"$1[id]",
  ));
  const method = identifier(input.request?.method);
  const category = diagnosticCategory(input.code, input.status);
  const fingerprint = createHash("sha256").update(JSON.stringify([category, input.code, route, method,
    reason.replace(/\b\d+\b/g, "#"), fields.map(f=>[f.path.replace(/\d+/g,"#"),f.code])])).digest("hex").slice(0, 20);
  return {
    at: now.toISOString(), category, fingerprint, route, method,
    code: identifier(input.code), status: input.status, requestId: identifier(input.requestId),
    ...(input.diagnosticId ? {diagnosticId: identifier(input.diagnosticId)} : {}),
    durationMs: Math.max(0, Math.round(input.durationMs)),
    release: identifier(process.env.APP_RELEASE_SHA ?? process.env.APP_BUILD_ID),
    clientVersion: identifier(input.request?.headers.get("X-RIIC-Client-Version")),
    clientSchema: identifier(input.request?.headers.get("X-RIIC-Client-Schema")),
    reason, causes, fields,
  };
}

export function assertDiagnosticRoot(root: string, cwd: string, home: string): void {
  const publicRoot = path.join(cwd,"public");
  // systemd may deliberately set HOME to BETA_STORAGE_DIR. Only the dedicated
  // diagnostic-logs child is touched; no operation prunes the configured base.
  const disallowedRoots = root === path.resolve(home) ? [cwd] : [cwd,home];
  if (!isSafePrivateStorageRoot(root,disallowedRoots) || root === publicRoot || isPrivateStorageChild(publicRoot,root)) {
    throw new Error("diagnostic_storage_must_be_private");
  }
}

function diagnosticRoot(): string | null {
  const configured = process.env.BETA_STORAGE_DIR;
  if (!configured) return null;
  if (!path.isAbsolute(configured)) throw new Error("diagnostic_storage_must_be_absolute");
  const root = realpathSync(configured);
  const cwd = path.resolve(process.cwd());
  assertDiagnosticRoot(root,cwd,homedir());
  const directory = path.join(root, "diagnostic-logs");
  mkdirSync(directory, {recursive: true, mode: 0o700});
  if (lstatSync(directory).isSymbolicLink() || realpathSync(directory) !== directory) throw new Error("diagnostic_storage_symlink");
  return directory;
}

/** A separate append-only diagnostic copy; NEVER part of private BOX/TTL cleanup. */
export function persistDiagnostic(record: DiagnosticRecord): void {
  try {
    const root = diagnosticRoot();
    if (!root) return;
    const fd=openSync(path.join(root, `${record.at.slice(0,10)}.ndjson`), constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0),0o600);
    try { appendFileSync(fd,`${JSON.stringify(record)}\n`); }
    finally { closeSync(fd); }
  } catch {
    // The original structured console event remains in journald, even if this copy fails.
    console.error(JSON.stringify({level:"error", event:"diagnostic_archive_write_failed", requestId:record.requestId}));
  }
}

export function summarizeDiagnostics(records: DiagnosticRecord[], from: Date, to: Date): DiagnosticReport {
  const rows = records.filter(row => row.at >= from.toISOString() && row.at <= to.toISOString()).sort((a,b)=>b.at.localeCompare(a.at));
  const groups = new Map<string, DiagnosticReport["groups"][number]>();
  for (const row of rows) {
    const group = groups.get(row.fingerprint);
    if (group) { group.count++; group.first = row.at; }
    else groups.set(row.fingerprint, {fingerprint:row.fingerprint, category:row.category, code:row.code, route:row.route,
      method:row.method, reason:row.reason, count:1, first:row.at, last:row.at});
  }
  return {from:from.toISOString(), to:to.toISOString(), configured:true, truncated:false, total:rows.length,
    groups:[...groups.values()].sort((a,b)=>b.count-a.count), recent:rows.slice(0,100)};
}

export async function readDiagnostics(hours: 1 | 24, now = new Date()): Promise<DiagnosticReport> {
  const from = new Date(now.getTime() - hours * 3_600_000);
  const root = diagnosticRoot();
  const records: DiagnosticRecord[] = [];
  let budget = 16 * 1024 * 1024;
  let truncated = false;
  if (root) {
    for (let day = Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()); day >= Date.UTC(from.getUTCFullYear(),from.getUTCMonth(),from.getUTCDate()); day -= 86_400_000) {
      let file;
      try { file = await open(path.join(root, `${new Date(day).toISOString().slice(0,10)}.ndjson`), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
      catch(error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      try {
        const size = (await file.stat()).size;
        const length = Math.min(size,budget);
        truncated ||= length < size;
        budget -= length;
        if (!length) continue;
        const buffer = Buffer.alloc(length);
        const {bytesRead} = await file.read(buffer,0,length,size-length);
        const lines = buffer.subarray(0,bytesRead).toString("utf8").split("\n");
        if (length < size) lines.shift();
        for (const line of lines) {
          if (!line) continue;
          try {
            const row = JSON.parse(line) as DiagnosticRecord;
            if (typeof row.at === "string" && typeof row.fingerprint === "string" && Array.isArray(row.fields)) records.push(row);
          } catch { truncated = true; }
        }
      } finally { await file.close(); }
    }
  }
  return {...summarizeDiagnostics(records,from,now), configured:Boolean(root), truncated};
}
