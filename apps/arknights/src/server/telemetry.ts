import { randomUUID } from "node:crypto";

export const TELEMETRY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_TELEMETRY_EVENTS_PER_REQUEST = 20;

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const ALLOWED_EVENT_KEYS = new Set(["sessionId", "type", "name", "durationMs", "value", "page", "meta"]);
const ALLOWED_TYPES = new Set(["performance", "interaction", "navigation", "error", "environment"]);
const ALLOWED_NAMES = new Set([
  "device_info",
  "web_vitals_fcp",
  "web_vitals_lcp",
  "web_vitals_cls",
  "web_vitals_ttfb",
  "web_vitals_inp",
  "long_task_total",
  "resource_images",
  "plan_click",
  "plan_submit",
  "plan_response",
  "plan_render",
  "plan_result",
  "upgrade_simulation_submit",
  "upgrade_simulation_response",
  "page_view",
  "js_error",
  "api_error",
]);
const ALLOWED_META_KEYS = new Set([
  "error_code",
  "cache_hit",
  "count",
  "bytes",
  "shift_index",
  "device_type",
  "os",
  "browser",
  "screen_width",
  "screen_height",
  "dpr",
  "memory_gb",
  "cores",
  "effective_type",
  "save_data",
]);

export type ValidatedTelemetryEvent = {
  sessionId: string;
  type: string;
  name: string;
  durationMs?: number;
  value?: number;
  page?: string;
  meta?: Record<string, string | number | boolean>;
};

function postgresInteger(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 && numeric <= MAX_POSTGRES_INTEGER ? numeric : null;
}

export function validateTelemetryEvent(value: unknown): ValidatedTelemetryEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (Object.keys(event).some((key) => !ALLOWED_EVENT_KEYS.has(key))) return null;
  if (typeof event.sessionId !== "string" || event.sessionId.length === 0 || event.sessionId.length > 128) return null;
  if (typeof event.type !== "string" || !ALLOWED_TYPES.has(event.type)) return null;
  if (typeof event.name !== "string" || !ALLOWED_NAMES.has(event.name)) return null;
  const durationMs = postgresInteger(event.durationMs);
  const numberValue = postgresInteger(event.value);
  if (durationMs === null || numberValue === null) return null;
  if (event.page !== undefined && (typeof event.page !== "string" || event.page.length > 120)) return null;

  let meta: Record<string, string | number | boolean> | undefined;
  if (event.meta !== undefined) {
    if (!event.meta || typeof event.meta !== "object" || Array.isArray(event.meta)) return null;
    const rawMeta = event.meta as Record<string, unknown>;
    meta = {};
    for (const [key, metaValue] of Object.entries(rawMeta)) {
      if (!ALLOWED_META_KEYS.has(key)) return null;
      if (typeof metaValue === "string") {
        if (metaValue.length > 120) return null;
      } else if (typeof metaValue === "number") {
        if (!Number.isFinite(metaValue) || Math.abs(metaValue) > MAX_POSTGRES_INTEGER) return null;
      } else if (typeof metaValue !== "boolean") {
        return null;
      }
      meta[key] = metaValue;
    }
  }
  return {
    sessionId: event.sessionId,
    type: event.type,
    name: event.name,
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(numberValue === undefined ? {} : { value: numberValue }),
    ...(event.page === undefined ? {} : { page: event.page as string }),
    ...(meta === undefined ? {} : { meta }),
  };
}

export function telemetryEventValues(
  event: ValidatedTelemetryEvent,
  context: { userId: string | null; dataOwnerTag: string | null; now: Date; id?: string },
) {
  return {
    id: context.id ?? randomUUID(),
    sessionId: event.sessionId,
    userId: context.userId,
    dataOwnerTag: context.dataOwnerTag,
    type: event.type,
    name: event.name,
    durationMs: event.durationMs ?? null,
    value: event.value ?? null,
    page: event.page ?? null,
    meta: event.meta ?? null,
    createdAt: context.now,
    expiresAt: new Date(context.now.getTime() + TELEMETRY_TTL_MS),
  };
}

/** Report only schema paths, never values supplied by a browser. */
export function telemetryValidationIssue(value: unknown): {path:string; code:string; message:string} | null {
  if (validateTelemetryEvent(value)) return null;
  const issue = (path:string, code:string) => ({path,code,message:`telemetry_${code}`});
  if (!value || typeof value!=="object" || Array.isArray(value)) return issue("event","invalid_object");
  const event=value as Record<string,unknown>;
  if (Object.keys(event).some(key=>!ALLOWED_EVENT_KEYS.has(key))) return issue("event","unknown_field");
  if (typeof event.sessionId!=="string" || !event.sessionId.length || event.sessionId.length>128) return issue("sessionId","invalid_session");
  if (typeof event.type!=="string" || !ALLOWED_TYPES.has(event.type)) return issue("type","unknown_type");
  if (typeof event.name!=="string" || !ALLOWED_NAMES.has(event.name)) return issue("name","unknown_name");
  if (postgresInteger(event.durationMs)===null) return issue("durationMs","invalid_integer");
  if (postgresInteger(event.value)===null) return issue("value","invalid_integer");
  if (event.page!==undefined && (typeof event.page!=="string" || event.page.length>120)) return issue("page","invalid_page");
  return issue("meta","invalid_metadata");
}
