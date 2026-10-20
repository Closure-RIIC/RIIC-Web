export const TELEMETRY_SESSION_STORAGE_KEY = "arknights-infra-telemetry-session";

export type TelemetryType = "performance" | "interaction" | "navigation" | "error" | "environment";

export type TelemetryInput = {
  type: TelemetryType;
  name: string;
  durationMs?: number;
  value?: number;
  page?: string;
  meta?: Record<string, string | number | boolean>;
};
