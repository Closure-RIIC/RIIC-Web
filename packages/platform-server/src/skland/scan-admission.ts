import { createHash } from "node:crypto";

export const MAX_CONCURRENT_SCAN_STARTS = 8;
export const SCAN_TTL_MS = 10 * 60 * 1000;

export type ScanStartResult = {
  scanId: string;
  scanUrl: string;
  expiresInSeconds: number;
};

export type ReusableScanRecord = {
  actorKey: string;
  scanUrl: string;
  createdAt: number;
  policyConsent: {
    termsVersion: string;
    privacyVersion: string;
  };
};

export function scanActorKey(websiteUserId: string): string {
  return createHash("sha256")
    .update("riic-web:skland-scan:")
    .update(websiteUserId)
    .digest("hex");
}

export function findOwnedScan<T extends Pick<ReusableScanRecord, "actorKey">>(
  scans: ReadonlyMap<string, T>,
  scanId: string,
  websiteUserId: string,
): T | null {
  const scan = scans.get(scanId);
  return scan?.actorKey === scanActorKey(websiteUserId) ? scan : null;
}

export function findReusableScan(
  scans: Iterable<readonly [string, ReusableScanRecord]>,
  actorKey: string,
  consent: { termsVersion: string; privacyVersion: string },
  now = Date.now()
): ScanStartResult | null {
  for (const [scanId, scan] of scans) {
    if (
      scan.actorKey === actorKey
      && scan.policyConsent.termsVersion === consent.termsVersion
      && scan.policyConsent.privacyVersion === consent.privacyVersion
      && now - scan.createdAt < SCAN_TTL_MS
    ) {
      return {
        scanId,
        scanUrl: scan.scanUrl,
        expiresInSeconds: Math.max(1, Math.ceil((scan.createdAt + SCAN_TTL_MS - now) / 1000)),
      };
    }
  }
  return null;
}

export function hasScanStartCapacity(activeStarts: number): boolean {
  return activeStarts < MAX_CONCURRENT_SCAN_STARTS;
}
