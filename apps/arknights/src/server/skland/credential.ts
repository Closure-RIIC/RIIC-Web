import { createHash, createHmac } from "node:crypto";

export const MAX_SKLAND_CREDENTIAL_BYTES = 12 * 1024;
export const SKLAND_TEENAGER_PATH = "/api/v1/user/teenager";

const INVALID_FIELD_RE = /^(?:null|undefined)$/i;
const STABLE_USER_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}

export class SklandCredentialFormatError extends Error {
  constructor() {
    super("森空岛凭证格式无效。");
    this.name = "SklandCredentialFormatError";
  }
}

function credentialFormatError(): never {
  throw new SklandCredentialFormatError();
}

export function parseSklandCredential(value: unknown): { cred: string; token: string } {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_SKLAND_CREDENTIAL_BYTES) {
    return credentialFormatError();
  }

  let normalized = value.trim();
  const first = normalized[0];
  const last = normalized.at(-1);
  if (first === "\"" || first === "'" || last === "\"" || last === "'") {
    if (normalized.length < 2 || first !== last || (first !== "\"" && first !== "'")) {
      return credentialFormatError();
    }
    normalized = normalized.slice(1, -1).trim();
  }

  if (!normalized || containsControlCharacter(normalized)) return credentialFormatError();
  const separator = normalized.indexOf(",");
  if (separator <= 0 || separator !== normalized.lastIndexOf(",")) return credentialFormatError();

  const cred = normalized.slice(0, separator).trim();
  const token = normalized.slice(separator + 1).trim();
  if (
    !cred
    || !token
    || INVALID_FIELD_RE.test(cred)
    || INVALID_FIELD_RE.test(token)
    || containsControlCharacter(cred)
    || containsControlCharacter(token)
  ) {
    return credentialFormatError();
  }
  return { cred, token };
}

export interface SklandSignatureHeaders {
  platform: "3";
  timestamp: string;
  dId: string;
  vName: "1.0.0";
}

export function createSklandRequestSignature({
  token,
  path,
  query = "",
  body = "",
  timestamp,
  headers,
}: {
  token: string;
  path: string;
  query?: string;
  body?: string;
  timestamp: string;
  headers: SklandSignatureHeaders;
}): string {
  const payload = `${path}${query}${body}${timestamp}${JSON.stringify(headers)}`;
  const hmac = createHmac("sha256", token).update(payload, "utf8").digest("hex");
  return createHash("md5").update(hmac, "utf8").digest("hex");
}

export function sklandSignedHeaders({
  cred,
  token,
  dId,
  path,
  query = "",
  body = "",
  now = Date.now(),
}: {
  cred: string;
  token: string;
  dId: string;
  path: string;
  query?: string;
  body?: string;
  now?: number;
}): Record<string, string> {
  const timestamp = String(Math.floor((now - 2_000) / 1_000));
  const signatureHeaders: SklandSignatureHeaders = {
    platform: "3",
    timestamp,
    dId,
    vName: "1.0.0",
  };
  return {
    "user-agent": "Mozilla/5.0 (Linux; Android 12; SM-A5560 Build/V417IR; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/101.0.4951.61 Safari/537.36; SKLand/1.52.1",
    "accept-encoding": "gzip",
    connection: "close",
    "x-requested-with": "com.hypergryph.skland",
    ...signatureHeaders,
    sign: createSklandRequestSignature({
      token,
      path,
      query,
      body,
      timestamp,
      headers: signatureHeaders,
    }),
    cred,
  };
}

export function mowerSklandSignedHeaders({
  cred,
  token,
  path,
  query = "",
  now = Date.now(),
}: {
  cred: string;
  token: string;
  path: string;
  query?: string;
  now?: number;
}): Record<string, string> {
  const timestamp = String(Math.floor((now - 2_000) / 1_000));
  const signatureHeaders = {
    platform: "",
    timestamp,
    dId: "",
    vName: "",
  };
  const payload = `${path}${query}${timestamp}${JSON.stringify(signatureHeaders)}`;
  const hmac = createHmac("sha256", token).update(payload, "utf8").digest("hex");
  return {
    cred,
    "user-agent": "Skland/1.53.0 (com.hypergryph.skland; build:105300018; Android 31; ) Okhttp/4.11.0",
    "accept-encoding": "gzip",
    connection: "close",
    ...signatureHeaders,
    sign: createHash("md5").update(hmac, "utf8").digest("hex"),
  };
}

export function stableSklandUserIdFromResponse(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const response = value as {
    code?: unknown;
    data?: { teenager?: { userId?: unknown } };
  };
  if (response.code !== 0) return null;
  const userId = response.data?.teenager?.userId;
  if (typeof userId !== "string") return null;
  const normalized = userId.trim();
  return STABLE_USER_ID_RE.test(normalized) ? normalized : null;
}
