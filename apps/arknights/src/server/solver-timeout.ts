// Keep the process timer and shared-cache lease on the same timeout budget.
export function solverTimeoutMs(value = process.env.BETA_CLI_TIMEOUT_MS): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(2_147_000_000 - 20_000, Math.max(1, Math.floor(parsed)))
    : 180_000;
}

export function planCacheLeaseDurationMs(): number {
  return Math.max(30_000, solverTimeoutMs() + 15_000);
}
