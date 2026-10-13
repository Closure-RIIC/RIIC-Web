import type { CloudWorkspacePutRequest } from "./types.ts";

export const CLOUD_SYNC_METADATA_PREFIX = "arknights-infra-cloud-sync-v1";

export type CloudSyncStatus = "idle" | "local-only" | "pending" | "syncing" | "synced" | "error" | "conflict";

export function cloudSyncPreferenceKey(userId: string): string {
  return `arknights-infra-cloud-sync-preference:${userId}`;
}

export type CloudSyncMetadata = {
  revision: number;
  fingerprint: string;
};

type UploadRequest = Exclude<CloudWorkspacePutRequest, { restoreRevisionId: string }>;

export function cloudWorkspaceFingerprint(value: UploadRequest): string {
  const text = JSON.stringify({ state: value.state, operbox: value.operbox, result: value.result });
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  return `${text.length.toString(36)}-${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

export function cloudSyncMetadataKey(userId: string): string {
  return `${CLOUD_SYNC_METADATA_PREFIX}:${userId}`;
}

export function readCloudSyncMetadata(storage: Pick<Storage, "getItem">, userId: string): CloudSyncMetadata | null {
  try {
    const value = JSON.parse(storage.getItem(cloudSyncMetadataKey(userId)) ?? "null") as Partial<CloudSyncMetadata> | null;
    return value && Number.isSafeInteger(value.revision) && Number(value.revision) >= 0 && typeof value.fingerprint === "string"
      ? { revision: Number(value.revision), fingerprint: value.fingerprint }
      : null;
  } catch {
    return null;
  }
}

export function writeCloudSyncMetadata(storage: Pick<Storage, "setItem">, userId: string, value: CloudSyncMetadata): void {
  storage.setItem(cloudSyncMetadataKey(userId), JSON.stringify(value));
}
