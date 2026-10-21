import type { ReleaseEnvironment } from "./types.ts";

export const RELEASE_SEEN_KEY = "riic-release-seen-v1";
export const RELEASE_SEEN_EVENT = "riic-release-seen";

// Revision 3 intentionally gives every production browser one fresh v0.6.1
// announcement. Once acknowledged, the new marker keeps later reloads and
// redeployments quiet exactly as before.
const PRODUCTION_RELEASE_SEEN_STORAGE_REVISION = 3;

export function releaseSeenKey(environment: ReleaseEnvironment): string {
  const revision = environment === "production" ? PRODUCTION_RELEASE_SEEN_STORAGE_REVISION : 2;
  return `riic-release-seen-v${revision}:${environment}`;
}

type ReleaseStorage = Pick<Storage, "getItem" | "setItem">;

function versionParts(version: string): number[] | null {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) return null;
  const parts = version.split(".").map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

/** Invalid old records are treated as unread; a rollback never announces an older release. */
export function isReleaseUnread(current: string, seen: string | null): boolean {
  const next = versionParts(current);
  if (!next) return false;
  const previous = seen ? versionParts(seen) : null;
  if (!previous) return true;
  for (let i = 0; i < next.length; i += 1) {
    if (next[i] !== previous[i]) return next[i] > previous[i];
  }
  return false;
}

export function readSeenRelease(storage: ReleaseStorage, key = RELEASE_SEEN_KEY): string | null {
  try { return storage.getItem(key); } catch { return null; }
}

export function rememberRelease(storage: ReleaseStorage, version: string, key = RELEASE_SEEN_KEY): void {
  try {
    if (isReleaseUnread(version, storage.getItem(key))) {
      storage.setItem(key, version);
    }
  } catch {
    // Storage may be blocked or full. The in-memory dismissal still applies.
  }
}

const sessionSeen = new Map<ReleaseEnvironment, string>();

export function isBrowserReleaseUnread(version: string, environment: ReleaseEnvironment): boolean {
  if (!isReleaseUnread(version, sessionSeen.get(environment) ?? null)) return false;
  try {
    const seen = readSeenRelease(window.localStorage, releaseSeenKey(environment));
    return isReleaseUnread(version, seen);
  }
  catch { return true; }
}

export function markBrowserReleaseSeen(version: string, environment: ReleaseEnvironment): void {
  if (isReleaseUnread(version, sessionSeen.get(environment) ?? null)) sessionSeen.set(environment, version);
  try { rememberRelease(window.localStorage, version, releaseSeenKey(environment)); } catch { /* Storage getter can throw. */ }
  window.dispatchEvent(new Event(RELEASE_SEEN_EVENT));
}
