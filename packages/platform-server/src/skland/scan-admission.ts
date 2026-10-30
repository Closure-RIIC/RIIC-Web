import { createHash } from "node:crypto";

export const MAX_CONCURRENT_SCAN_STARTS = 8;
export const SCAN_TTL_MS = 10 * 60 * 1000;
export const MAX_SCAN_STARTS_PER_ACCOUNT = 5;
export const MAX_SCAN_STARTS_PER_IP = 10;
export const MIN_SCAN_START_INTERVAL_MS = 10_000;

export type ScanStartResult = {
  scanId: string;
  scanUrl: string;
  expiresInSeconds: number;
  refreshAfterSeconds: number;
};

export function scanActorKey(websiteUserId: string): string {
  return createHash("sha256")
    .update("riic-web:skland-scan:")
    .update(websiteUserId)
    .digest("hex");
}

export function findOwnedScan<T extends { actorKey: string }>(
  scans: ReadonlyMap<string, T>,
  scanId: string,
  websiteUserId: string,
): T | null {
  const scan = scans.get(scanId);
  return scan?.actorKey === scanActorKey(websiteUserId) ? scan : null;
}

/** Both rolling windows and the minimum interval must have opened before admission. */
export function scanStartRetryAfter(
  accountStarts: readonly number[],
  ipStarts: readonly number[],
  now = Date.now(),
): number {
  const account = accountStarts.filter(time => now - time < SCAN_TTL_MS);
  const ip = ipStarts.filter(time => now - time < SCAN_TTL_MS);
  const intervalEnd = account.length ? account[account.length - 1] + MIN_SCAN_START_INTERVAL_MS : now;
  const accountWindowEnd = account.length >= MAX_SCAN_STARTS_PER_ACCOUNT
    ? account[account.length - MAX_SCAN_STARTS_PER_ACCOUNT] + SCAN_TTL_MS : now;
  const ipWindowEnd = ip.length >= MAX_SCAN_STARTS_PER_IP
    ? ip[ip.length - MAX_SCAN_STARTS_PER_IP] + SCAN_TTL_MS : now;
  return Math.max(0, Math.ceil((Math.max(intervalEnd, accountWindowEnd, ipWindowEnd) - now) / 1000));
}

export function hasScanStartCapacity(activeStarts: number): boolean {
  return activeStarts < MAX_CONCURRENT_SCAN_STARTS;
}
