// Response-aware batching; sendBeacon is only a page-exit fallback.
// 只采集白名单事件；字段校验在服务端 /api/telemetry 完成。

import {
  TELEMETRY_SESSION_STORAGE_KEY,
  type TelemetryInput,
  type TelemetryType,
} from "@/telemetry-contract";
import { createTelemetryQueue } from "./telemetry-queue";

const TELEMETRY_ENDPOINT = "/api/telemetry";
const PERFORMANCE_SAMPLE_RATE = 1;
const COOLDOWN_KEY = "riic-telemetry-cooldown-v1";

/** 设备环境快照：会话级一条，不随每条事件重复上报。 */
function collectDeviceInfo(): Record<string, string | number | boolean> {
  const info: Record<string, string | number | boolean> = {};
  const uaData = (navigator as Navigator & {
    userAgentData?: { mobile?: boolean; platform?: string; brands?: Array<{ brand: string; version: string }> };
  }).userAgentData;
  const ua = navigator.userAgent;
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const finePointer = window.matchMedia("(pointer: fine)").matches;

  // 设备类型：优先 UA-CH mobile，其次按指针能力推断触屏设备。
  if (uaData?.mobile) {
    info.device_type = "mobile";
  } else if (coarsePointer && !finePointer) {
    info.device_type = "mobile";
  } else if (coarsePointer && finePointer) {
    info.device_type = "tablet";
  } else {
    info.device_type = "desktop";
  }

  const platform = uaData?.platform ?? "";
  if (platform === "Windows" || /Windows/.test(ua)) info.os = "windows";
  else if (platform === "macOS" || /Mac OS X|Macintosh/.test(ua)) info.os = "macos";
  else if (/Android/.test(ua)) info.os = "android";
  else if (/iPhone|iPad|iPod/.test(ua)) info.os = "ios";
  else if (/Linux/.test(ua)) info.os = "linux";
  else info.os = "unknown";

  if (/Edg\//.test(ua)) info.browser = "edge";
  else if (/Firefox\//.test(ua)) info.browser = "firefox";
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) info.browser = "chrome";
  else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) info.browser = "safari";
  else info.browser = "unknown";

  info.screen_width = window.screen.width;
  info.screen_height = window.screen.height;
  info.dpr = window.devicePixelRatio || 1;
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (typeof deviceMemory === "number") info.memory_gb = deviceMemory;
  const cores = (navigator as Navigator & { hardwareConcurrency?: number }).hardwareConcurrency;
  if (typeof cores === "number") info.cores = cores;
  const connection = (navigator as Navigator & {
    connection?: { effectiveType?: string; saveData?: boolean };
  }).connection;
  if (connection?.effectiveType) info.effective_type = connection.effectiveType;
  if (typeof connection?.saveData === "boolean") info.save_data = connection.saveData;
  return info;
}

type QueuedEvent = TelemetryInput & {
  sessionId: string;
};

let fallbackSessionId: string | null = null;
const queue = createTelemetryQueue<QueuedEvent>({
  now: Date.now,
  schedule: (callback,delay) => setTimeout(callback,delay),
  cancel: (timer) => clearTimeout(timer),
  readCooldown: () => {
    try { const value=Number(window.localStorage.getItem(COOLDOWN_KEY)); return Number.isFinite(value) ? Math.min(value,Date.now()+3_600_000) : 0; }
    catch { return 0; }
  },
  writeCooldown: (until) => { try { window.localStorage.setItem(COOLDOWN_KEY,String(until)); } catch { /* optional */ } },
  send: async (events) => {
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),10_000);
    try {
      const response=await fetch(TELEMETRY_ENDPOINT, {
        method:"POST", headers:{"Content-Type":"application/json", "X-RIIC-Client-Schema":"2",
          "X-RIIC-Client-Version":process.env.APP_CLIENT_BUILD_ID ?? "local-development"},
        body:JSON.stringify({events}), keepalive:true, signal:controller.signal,
      });
      return {status:response.status,retryAfter:response.headers.get("Retry-After")};
    } finally { clearTimeout(timeout); }
  },
  beacon: (events) => {
    try { return navigator.sendBeacon(TELEMETRY_ENDPOINT,new Blob([JSON.stringify({events})],{type:"application/json"})); }
    catch { return false; }
  },
});

function getSessionId(): string {
  try {
    let value = window.localStorage.getItem(TELEMETRY_SESSION_STORAGE_KEY);
    if (!value) {
      value = crypto.randomUUID();
      window.localStorage.setItem(TELEMETRY_SESSION_STORAGE_KEY, value);
    }
    return value;
  } catch {
    return fallbackSessionId ??= crypto.randomUUID();
  }
}

function shouldSample(type: TelemetryType): boolean {
  return type !== "performance" || Math.random() < PERFORMANCE_SAMPLE_RATE;
}

export function track(input: TelemetryInput): void {
  if (!shouldSample(input.type)) return;
  queue.enqueue({
    ...input,
    ...(input.page ? {page:input.page.split(/[?#]/)[0].slice(0,120)} : {}),
    ...(input.durationMs === undefined ? {} : {durationMs:Math.max(0,Math.min(2_147_483_647,Math.round(input.durationMs)))}),
    ...(input.value === undefined ? {} : {value:Math.max(0,Math.min(2_147_483_647,Math.round(input.value)))}),
    sessionId: getSessionId(),
  });
}

/** 手动立即上报（页面卸载前调用，防止丢数据）。 */
export function flushTelemetry(): void {
  if (document.visibilityState === "hidden") queue.hide();
  else void queue.flush();
}

// 页面卸载/隐藏前冲刷剩余队列。
if (typeof window !== "undefined") {
  track({ type: "environment", name: "device_info", meta: collectDeviceInfo() });
  window.addEventListener("pagehide", () => queue.hide());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushTelemetry();
  });
}
