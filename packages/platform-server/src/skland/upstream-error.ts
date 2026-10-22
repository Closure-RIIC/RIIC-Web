export type SklandServiceErrorCode =
  | "NOT_CONFIGURED"
  | "INSECURE"
  | "RATE_LIMITED"
  | "AUTH_EXPIRED"
  | "UNAVAILABLE"
  | "BAD_DATA";

export const SKLAND_UPSTREAM_COOLDOWN_MS = 60_000;

function errorRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function textValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

export function classifySklandUpstreamError(error: unknown): "AUTH_EXPIRED" | "RATE_LIMITED" | "UNAVAILABLE" {
  const record = errorRecord(error);
  const causeValue = record?.cause;
  const cause = errorRecord(causeValue);
  const status = Number(cause?.status ?? cause?.statusCode ?? cause?.code ?? Number.NaN);
  const combinedMessage = [
    textValue(record?.message ?? error),
    textValue(causeValue),
    textValue(cause?.message),
    textValue(cause?.msg),
    textValue(cause?.error),
  ].filter(Boolean).join(" ");

  if (
    status === 401
    || /cred|token|认证|unauthor|用户未登录|未授权|登录(?:态)?(?:已)?(?:失效|过期)|请重新登录|凭证.*(?:失效|过期)|(?:invalid|expired).*(?:cred|token)/i.test(combinedMessage)
  ) {
    return "AUTH_EXPIRED";
  }
  if (
    status === 429
    || /429|频繁|limit|too many|throttl/i.test(combinedMessage)
    || /<!doctype\s*html[\s\S]*<title>\s*405\s*<\/title>/i.test(combinedMessage)
  ) {
    return "RATE_LIMITED";
  }
  return "UNAVAILABLE";
}
