const MINIMUM_SECRET_BYTES = 32;

export const BUSINESS_DATA_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const PLAN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const WORKSPACE_REVISION_LIMIT = 10;
export const SAVED_PLAN_LIMIT = 5;

export function isBusinessDatabaseEnabled(): boolean {
  return process.env.BETA_BUSINESS_DB_ENABLED === "1";
}

export function isBusinessDatabaseReadEnabled(): boolean {
  return isBusinessDatabaseEnabled() && process.env.BETA_BUSINESS_DB_READ_ENABLED === "1";
}

export function isBusinessFileFallbackEnabled(): boolean {
  return process.env.BETA_BUSINESS_FILE_READ_FALLBACK !== "0";
}

export function isAccountCloudSyncEnabled(): boolean {
  return isBusinessDatabaseEnabled() && process.env.ACCOUNT_CLOUD_SYNC_ENABLED === "1";
}

export function isPlanCacheEnabled(): boolean {
  return isBusinessDatabaseEnabled() && process.env.PLAN_CACHE_ENABLED === "1";
}

export function isPlanTaskQueueEnabled(): boolean {
  return isBusinessDatabaseEnabled() && process.env.PLAN_TASK_QUEUE_ENABLED === "1";
}

function decodeSecret(value: string, name: string): Buffer {
  const trimmed = value.trim();
  const decoded = trimmed.startsWith("base64:")
    ? Buffer.from(trimmed.slice("base64:".length), "base64")
    : Buffer.from(trimmed, "utf8");
  if (decoded.byteLength < MINIMUM_SECRET_BYTES) {
    throw new Error(`${name} must contain at least ${MINIMUM_SECRET_BYTES} bytes.`);
  }
  return decoded;
}

export function workspaceMasterKeys(): { activeVersion: string; keys: Map<string, Buffer> } {
  const activeVersion = process.env.WORKSPACE_ACTIVE_KEY_VERSION?.trim();
  const encoded = process.env.WORKSPACE_MASTER_KEYS?.trim();
  if (!activeVersion || !encoded) {
    throw new Error("WORKSPACE_ACTIVE_KEY_VERSION and WORKSPACE_MASTER_KEYS are required for cloud sync and task encryption.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch (cause) {
    throw new Error("WORKSPACE_MASTER_KEYS must be a JSON object of versioned secrets.", { cause });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("WORKSPACE_MASTER_KEYS must be a JSON object of versioned secrets.");
  }

  const keys = new Map<string, Buffer>();
  for (const [version, value] of Object.entries(parsed)) {
    if (!/^[A-Za-z0-9._-]{1,32}$/.test(version) || typeof value !== "string") {
      throw new Error("WORKSPACE_MASTER_KEYS contains an invalid version or secret.");
    }
    const key = decodeSecret(value, `WORKSPACE_MASTER_KEYS.${version}`);
    if (key.byteLength !== 32) throw new Error(`WORKSPACE_MASTER_KEYS.${version} must decode to exactly 32 bytes.`);
    keys.set(version, key);
  }
  if (!keys.has(activeVersion)) throw new Error("WORKSPACE_ACTIVE_KEY_VERSION is missing from WORKSPACE_MASTER_KEYS.");
  return { activeVersion, keys };
}

export function planCacheHmacKey(): Buffer {
  const value = process.env.PLAN_CACHE_HMAC_KEY?.trim();
  if (!value) throw new Error("PLAN_CACHE_HMAC_KEY is required when the shared plan cache is enabled.");
  return decodeSecret(value, "PLAN_CACHE_HMAC_KEY");
}
