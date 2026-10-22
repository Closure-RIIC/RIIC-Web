export const SKLAND_QR_POLL_INTERVAL_MS = 6_000;
export const SKLAND_QR_MAX_BACKOFF_MS = 48_000;

interface SklandQrPollDelayOptions {
  failedAttempts: number;
  expiresAt: number;
  now?: number;
  retryAfterSeconds?: number;
}

interface RemainingSklandQrPollDelayOptions {
  nextPollAt: number | null;
  expiresAt: number;
  now?: number;
}

export function nextSklandQrPollDelay({
  failedAttempts,
  expiresAt,
  now = Date.now(),
  retryAfterSeconds,
}: SklandQrPollDelayOptions): number | null {
  const remainingMs = expiresAt - now;
  if (remainingMs <= 0) return null;

  const boundedFailures = Math.max(0, Math.min(failedAttempts, 3));
  const backoffMs = Math.min(
    SKLAND_QR_MAX_BACKOFF_MS,
    SKLAND_QR_POLL_INTERVAL_MS * (2 ** boundedFailures),
  );
  const retryAfterMs = typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds)
    ? Math.max(0, retryAfterSeconds * 1_000)
    : 0;
  const delayMs = Math.max(backoffMs, retryAfterMs);

  return delayMs < remainingMs ? delayMs : null;
}

export function remainingSklandQrPollDelay({
  nextPollAt,
  expiresAt,
  now = Date.now(),
}: RemainingSklandQrPollDelayOptions): number | null {
  const remainingLifetimeMs = expiresAt - now;
  if (remainingLifetimeMs <= 0) return null;
  if (nextPollAt === null) return 0;

  const remainingDelayMs = Math.max(0, nextPollAt - now);
  return remainingDelayMs < remainingLifetimeMs ? remainingDelayMs : null;
}
