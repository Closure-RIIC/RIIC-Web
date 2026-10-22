import { spawn } from "node:child_process";
import path from "node:path";

export type JsonRecord = Record<string, unknown>;

export type ServeRequest = {
  id: number;
  method: string;
  params: object;
};

export type ServeResult = {
  request: ServeRequest;
  response: JsonRecord;
  stdout: string;
  stderr: string;
};

export const SERVE_STREAM_LIMIT_BYTES = 8 * 1024 * 1024;

type StreamName = "stdout" | "stderr";

type PendingServeRequest = {
  key: string;
  request: ServeRequest;
  line: string;
  resolve: (value: ServeResult) => void;
  reject: (reason?: unknown) => void;
  timeoutMs: number;
  timer: NodeJS.Timeout | null;
  resendCount: number;
  state: "queued" | "active";
  capture: ServeRequestCapture;
};

export type InfraCliServeClientOptions = {
  resolveCliPath: () => string;
  resolveRuntimeDataDir: (cliPath: string) => string | null;
  timeoutMs: number;
  serveArgs?: readonly string[] | ((cliPath: string) => readonly string[]);
  cwd?: (cliPath: string) => string;
  childEnv?: Record<string,string>;
};

function utf8Suffix(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maxBytes) return value;

  let start = bytes.length - maxBytes;
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) {
    start += 1;
  }
  return bytes.subarray(start).toString("utf8");
}

export class CappedTextLog {
  private readonly marker: string;
  private readonly markerBytes: number;
  private readonly maxBytes: number;
  private chunks: string[] = [];
  private retainedBytes = 0;
  private truncated = false;

  constructor(
    stream: StreamName,
    maxBytes = SERVE_STREAM_LIMIT_BYTES
  ) {
    this.maxBytes = maxBytes;
    this.marker = `[... ${stream} truncated; only the newest output is retained ...]\n`;
    this.markerBytes = Buffer.byteLength(this.marker, "utf8");
    if (maxBytes <= this.markerBytes) {
      throw new Error("serve stream limit must be larger than its truncation marker");
    }
  }

  append(value: string) {
    if (!value) return;
    this.chunks.push(value);
    this.retainedBytes += Buffer.byteLength(value, "utf8");

    if (!this.truncated && this.retainedBytes > this.maxBytes) {
      this.truncated = true;
    }
    const payloadLimit = this.truncated ? this.maxBytes - this.markerBytes : this.maxBytes;
    this.trimTo(payloadLimit);
  }

  reset() {
    this.chunks = [];
    this.retainedBytes = 0;
    this.truncated = false;
  }

  value(): string {
    return `${this.truncated ? this.marker : ""}${this.chunks.join("")}`;
  }

  private trimTo(payloadLimit: number) {
    while (this.retainedBytes > payloadLimit && this.chunks.length > 0) {
      const first = this.chunks[0];
      const firstBytes = Buffer.byteLength(first, "utf8");
      const excess = this.retainedBytes - payloadLimit;
      if (firstBytes <= excess) {
        this.chunks.shift();
        this.retainedBytes -= firstBytes;
        continue;
      }

      const retained = utf8Suffix(first, firstBytes - excess);
      this.chunks[0] = retained;
      this.retainedBytes = payloadLimit - (firstBytes - excess - Buffer.byteLength(retained, "utf8"));
    }
  }
}

export class NdjsonLineBuffer {
  private buffer = "";
  private discardingOversizedLine = false;
  private readonly maxLineBytes: number;

  constructor(maxLineBytes = SERVE_STREAM_LIMIT_BYTES) {
    this.maxLineBytes = maxLineBytes;
  }

  push(chunk: string): string[] {
    let remaining = chunk;
    const lines: string[] = [];

    if (this.discardingOversizedLine) {
      const newline = remaining.indexOf("\n");
      if (newline < 0) return lines;
      remaining = remaining.slice(newline + 1);
      this.discardingOversizedLine = false;
    }

    this.buffer += remaining;
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (Buffer.byteLength(line, "utf8") <= this.maxLineBytes) {
        lines.push(line);
      }
    }

    if (Buffer.byteLength(this.buffer, "utf8") > this.maxLineBytes) {
      this.buffer = "";
      this.discardingOversizedLine = true;
    }
    return lines;
  }

  reset() {
    this.buffer = "";
    this.discardingOversizedLine = false;
  }
}

export function parseMatchingServeResponse(line: string, requestId: number): JsonRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    (parsed as JsonRecord).id !== requestId ||
    typeof (parsed as JsonRecord).ok !== "boolean"
  ) {
    return null;
  }
  return parsed as JsonRecord;
}

export class ServeRequestCapture {
  readonly stdout: CappedTextLog;
  readonly stderr: CappedTextLog;

  constructor(maxBytes = SERVE_STREAM_LIMIT_BYTES) {
    this.stdout = new CappedTextLog("stdout", maxBytes);
    this.stderr = new CappedTextLog("stderr", maxBytes);
  }

  reset() {
    this.stdout.reset();
    this.stderr.reset();
  }
}

export class InfraCliServeClient {
  private readonly options: InfraCliServeClientOptions;
  private child: ReturnType<typeof spawn> | null = null;
  private liveChildren = new Set<ReturnType<typeof spawn>>();
  private cliPath: string | null = null;
  private starting: Promise<void> | null = null;
  private stdoutLines = new NdjsonLineBuffer();
  private pending = new Map<string, PendingServeRequest>();
  private activeKey: string | null = null;
  private nextId = 1;
  private restartCount = 0;

  constructor(options: InfraCliServeClientOptions) {
    this.options = options;
  }

  ensureStarted() {
    if (this.child && !this.child.killed) {
      return Promise.resolve();
    }
    if (this.starting) {
      return this.starting;
    }

    this.starting = new Promise((resolve, reject) => {
      let cliPath = "";
      try {
        cliPath = this.options.resolveCliPath();
      } catch (error) {
        this.starting = null;
        reject(error);
        return;
      }

      const dataDir = this.options.resolveRuntimeDataDir(cliPath);
      const env = { ...process.env, ...this.options.childEnv };
      if (dataDir) {
        env.ARKNIGHTS_INFRA_DATA_DIR = dataDir;
      } else {
        delete env.ARKNIGHTS_INFRA_DATA_DIR;
      }
      const configuredArgs = typeof this.options.serveArgs === "function"
        ? this.options.serveArgs(cliPath)
        : this.options.serveArgs;
      const args = configuredArgs ? [...configuredArgs] : ["serve"];
      const cwd = this.options.cwd?.(cliPath) ?? path.dirname(cliPath);
      const child = spawn(/* turbopackIgnore: true */ cliPath, args, {
        cwd,
        env,
        windowsHide: true,
        shell: false,
      });
      let settled = false;

      this.liveChildren.add(child);
      child.once("close",()=>this.liveChildren.delete(child));

      this.child = child;
      this.cliPath = cliPath;
      this.stdoutLines.reset();
      this.restartCount += 1;

      const settleOk = () => {
        if (settled) return;
        settled = true;
        this.starting = null;
        resolve();
      };
      const settleError = (error: unknown) => {
        if (settled) return;
        settled = true;
        this.starting = null;
        reject(error);
      };

      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string | Buffer) => {
        settleOk();
        if (this.child !== child) return;
        this.handleStdout(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      });
      child.stderr?.on("data", (chunk: string | Buffer) => {
        if (this.child !== child) return;
        this.activePending()?.capture.stderr.append(
          typeof chunk === "string" ? chunk : chunk.toString("utf8")
        );
        settleOk();
      });
      child.stdin?.on("error", (error) => {
        this.handleWriteFailure(child, error);
      });
      child.on("spawn", settleOk);
      child.on("error", (error) => {
        if (this.child === child) {
          this.child = null;
        }
        settleError(error);
        this.rejectPending(`infra-cli serve 启动失败：${error.message}`);
      });
      child.on("close", (code, signal) => {
        this.handleClose(child, code, signal);
      });
    });

    return this.starting;
  }

  send(method: string, params: object, options: { timeoutMs?: number } = {}) {
    const id = this.nextId++;
    const request = { id, method, params };
    const line = JSON.stringify(request);
    const key = JSON.stringify(id);
    const requestTimeoutMs = options.timeoutMs ?? this.options.timeoutMs;

    return new Promise<ServeResult>((resolve, reject) => {
      const pending: PendingServeRequest = {
        key,
        request,
        line,
        resolve,
        reject,
        timeoutMs: requestTimeoutMs,
        timer: null,
        resendCount: 0,
        state: "queued",
        capture: new ServeRequestCapture(),
      };
      this.pending.set(key, pending);

      this.ensureStarted()
        .then(() => this.dispatchNext())
        .catch((error) => {
          if (this.pending.delete(key)) {
            reject(error);
          }
        });
    });
  }

  ping() {
    return this.send("ping", {}, { timeoutMs: 10_000 });
  }

  stop(reason = "infra-cli serve 已停止。") {
    const child = this.child;
    this.child = null;
    this.starting = null;
    this.rejectPending(reason);

    if (!child || child.killed) return;
    child.stdin?.end();
    child.kill();
  }

  info() {
    return {
      cliPath: this.cliPath,
      pid: this.child?.pid ?? null,
      running: Boolean(this.child && !this.child.killed),
      busy: Boolean(this.activeKey),
      restartCount: this.restartCount,
    };
  }

  /** Keep replaced children tracked until close; fallback must not overlap a timed-out search. */
  async stopAndWait(reason: string) {
    const children=[...this.liveChildren];
    this.stop(reason);
    await Promise.all(children.map(child=>new Promise<void>((resolve,reject)=>{
      if(!this.liveChildren.has(child)) {resolve();return;}
      const force=setTimeout(()=>child.kill("SIGKILL"),250);
      const deadline=setTimeout(()=>{cleanup();reject(new Error("Solver process did not close after termination."));},2_000);
      const onClose=()=>{cleanup();resolve();};
      const cleanup=()=>{clearTimeout(force);clearTimeout(deadline);child.off("close",onClose);};
      child.once("close",onClose);
      if(!child.killed) child.kill();
    })));
  }

  private activePending() {
    return this.activeKey ? this.pending.get(this.activeKey) ?? null : null;
  }

  private dispatchNext() {
    if (this.activeKey || !this.child || this.child.killed) return;
    const pending = [...this.pending.values()].find((candidate) => candidate.state === "queued");
    if (!pending) return;
    this.writePending(pending);
  }

  private writePending(pending: PendingServeRequest) {
    const child = this.child;
    if (!child || !child.stdin || child.stdin.destroyed) {
      throw new Error("infra-cli serve 未运行。");
    }

    pending.capture.reset();
    pending.state = "active";
    this.activeKey = pending.key;
    this.stdoutLines.reset();
    pending.timer = setTimeout(() => {
      if (this.pending.get(pending.key) !== pending) return;
      this.pending.delete(pending.key);
      this.activeKey = null;
      pending.timer = null;
      pending.reject(new Error(`infra-cli serve 请求超时（${pending.timeoutMs}ms）。`));
      this.replaceChild(child);
    }, pending.timeoutMs);

    try {
      child.stdin.write(`${pending.line}\n`, "utf8", (error) => {
        if (!error || this.pending.get(pending.key) !== pending) return;
        this.failPendingWrite(pending, child, error);
      });
    } catch (error) {
      this.failPendingWrite(pending, child, error);
    }
  }

  private failPendingWrite(pending: PendingServeRequest, child: ReturnType<typeof spawn>, error: unknown) {
    if (pending.timer) clearTimeout(pending.timer);
    this.pending.delete(pending.key);
    if (this.activeKey === pending.key) this.activeKey = null;
    pending.reject(error);
    this.replaceChild(child);
  }

  private handleWriteFailure(child: ReturnType<typeof spawn>, error: Error) {
    const pending = this.activePending();
    if (pending) {
      this.failPendingWrite(pending, child, error);
      return;
    }
    this.replaceChild(child);
  }

  private handleStdout(chunk: string) {
    const pending = this.activePending();
    if (!pending) {
      this.stdoutLines.reset();
      return;
    }

    pending.capture.stdout.append(chunk);
    for (const line of this.stdoutLines.push(chunk)) {
      const response = parseMatchingServeResponse(line, pending.request.id);
      if (!response) continue;
      this.finishPending(pending, response);
      break;
    }
  }

  private finishPending(pending: PendingServeRequest, response: JsonRecord) {
    if (pending.timer) clearTimeout(pending.timer);
    pending.timer = null;
    this.pending.delete(pending.key);
    if (this.activeKey === pending.key) this.activeKey = null;
    pending.resolve({
      request: pending.request,
      response,
      stdout: pending.capture.stdout.value(),
      stderr: pending.capture.stderr.value(),
    });
    queueMicrotask(() => this.dispatchNext());
  }

  private replaceChild(child: ReturnType<typeof spawn>) {
    if (this.child === child) {
      this.child = null;
      this.starting = null;
    }
    if (!child.killed) child.kill();
    if (this.pending.size > 0) this.resendPending();
  }

  private handleClose(child: ReturnType<typeof spawn>, code: number | null, signal: NodeJS.Signals | null) {
    if (this.child !== child) return;
    this.child = null;
    this.starting = null;

    const active = this.activePending();
    this.activeKey = null;
    if (active) {
      if (active.timer) clearTimeout(active.timer);
      active.timer = null;
      if (active.resendCount >= 1) {
        this.pending.delete(active.key);
        active.reject(new Error(this.closeErrorMessage(active, code, signal)));
      } else {
        active.resendCount += 1;
        active.state = "queued";
      }
    }

    if (this.pending.size > 0) this.resendPending();
  }

  private resendPending() {
    this.ensureStarted()
      .then(() => this.dispatchNext())
      .catch((error) => {
        this.rejectPending(error instanceof Error ? error.message : String(error));
      });
  }

  private closeErrorMessage(pending: PendingServeRequest, code: number | null, signal: NodeJS.Signals | null) {
    const stderr = pending.capture.stderr.value().trim();
    return [
      `infra-cli serve 已退出：code=${code ?? "null"} signal=${signal ?? "null"}`,
      stderr && `stderr:\n${stderr.slice(-2000)}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  private rejectPending(message: string) {
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
    this.activeKey = null;
  }
}
