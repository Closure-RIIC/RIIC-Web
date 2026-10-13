import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

import type { SklandAccountSummary, SklandRole } from "../../types.ts";
import { PRIVACY_VERSION, TERMS_VERSION } from "../../legal-policy.ts";

export const SKLAND_SESSION_COOKIE = "skland_session_v1";
export const SKLAND_ACCOUNT_INDEX_COOKIE = "skland_accounts_v3";
export const SKLAND_ACCOUNT_COOKIE_PREFIX = "skland_account_v3_";
export const LEGACY_SKLAND_ACCOUNT_INDEX_COOKIE = "skland_accounts_v2";
export const LEGACY_SKLAND_ACCOUNT_COOKIE_PREFIX = "skland_account_v2_";
export const SKLAND_ACCOUNT_LIMIT = 5;
export const SKLAND_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface SklandPolicyConsent {
  termsVersion: typeof TERMS_VERSION;
  privacyVersion: typeof PRIVACY_VERSION;
  acceptedAt: number;
}

export interface SklandSessionPayload {
  version: 3;
  cred: string;
  token: string;
  /** HG account OAuth, retained only inside the encrypted, owner-bound login cookie. */
  accountOAuthToken?: string;
  dId: string;
  userId: string;
  selectedUid: string;
  refreshedAt: number;
  expiresAt: number;
  policyConsent: SklandPolicyConsent;
}

export interface SklandStoredAccount {
  version: 3;
  accountId: string;
  session: SklandSessionPayload;
  roles: SklandRole[];
}

export interface SklandAccountIndexPayload {
  version: 3;
  accountIds: string[];
  activeAccountId: string | null;
  expiresAt: number;
}

export class SklandAccountLimitError extends Error {
  constructor() {
    super(`同一浏览器最多可登录 ${SKLAND_ACCOUNT_LIMIT} 个森空岛账号。`);
    this.name = "SklandAccountLimitError";
  }
}

function configuredSecret(explicit?: string): string {
  const secret = explicit ?? process.env.SKLAND_SESSION_SECRET ?? "";
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("SKLAND_SESSION_SECRET 未配置或长度不足 32 字节。");
  }
  return secret;
}

function keyFor(secret?: string): Buffer {
  return createHash("sha256").update(configuredSecret(secret)).digest();
}

function sealValue(value: unknown, secret?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

function unsealValue(value: string, secret?: string): unknown | null {
  try {
    const raw = Buffer.from(value, "base64url");
    if (raw.length <= 28) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", keyFor(secret), iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

function parsedSessionPayload(value: unknown, now: number): SklandSessionPayload | null {
  if (!value || typeof value !== "object") return null;
  const decoded = value as Partial<SklandSessionPayload>;
  if (
    decoded.version !== 3 ||
    typeof decoded.cred !== "string" ||
    typeof decoded.token !== "string" ||
    (decoded.accountOAuthToken !== undefined && (typeof decoded.accountOAuthToken !== "string" || !decoded.accountOAuthToken.trim())) ||
    typeof decoded.dId !== "string" ||
    typeof decoded.userId !== "string" ||
    typeof decoded.selectedUid !== "string" ||
    typeof decoded.refreshedAt !== "number" ||
    typeof decoded.expiresAt !== "number" ||
    !decoded.policyConsent ||
    decoded.policyConsent.termsVersion !== TERMS_VERSION ||
    decoded.policyConsent.privacyVersion !== PRIVACY_VERSION ||
    typeof decoded.policyConsent.acceptedAt !== "number" ||
    decoded.expiresAt <= now
  ) {
    return null;
  }
  return decoded as SklandSessionPayload;
}

function parsedRole(value: unknown): SklandRole | null {
  if (!value || typeof value !== "object") return null;
  const role = value as Partial<SklandRole>;
  if (
    typeof role.uid !== "string" ||
    typeof role.nickname !== "string" ||
    typeof role.channelName !== "string" ||
    typeof role.isDefault !== "boolean"
  ) {
    return null;
  }
  return {
    uid: role.uid,
    nickname: role.nickname,
    channelName: role.channelName,
    isDefault: role.isDefault,
  };
}

function validAccountId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(value);
}

export function isSklandConfigured(): boolean {
  return Buffer.byteLength(process.env.SKLAND_SESSION_SECRET ?? "", "utf8") >= 32;
}

export function sklandDisabledReason(): string | null {
  return isSklandConfigured() ? null : "SKLAND_SESSION_SECRET 未配置，森空岛登录已禁用。";
}

export function sealSklandSession(payload: SklandSessionPayload, secret?: string): string {
  return sealValue(payload, secret);
}

export function unsealSklandSession(value: string, secret?: string, now = Date.now()): SklandSessionPayload | null {
  return parsedSessionPayload(unsealValue(value, secret), now);
}

export function sklandAccountCookieName(accountId: string): string {
  if (!validAccountId(accountId)) throw new Error("森空岛账号标识无效。");
  return `${SKLAND_ACCOUNT_COOKIE_PREFIX}${accountId}`;
}

export function sealSklandAccount(account: SklandStoredAccount, secret?: string): string {
  return sealValue(account, secret);
}

export function websiteUserOwnerTag(userId: string, secret?: string): string {
  return createHmac("sha256", keyFor(secret)).update(`website:${userId}`).digest("hex");
}

export function sealOwnedSklandAccount(account: SklandStoredAccount, ownerTag: string, secret?: string): string {
  return sealValue({ ownerTag, account }, secret);
}

export function unsealOwnedSklandAccount(value: string, ownerTag: string, secret?: string, now = Date.now()): SklandStoredAccount | null {
  const decoded = unsealValue(value, secret);
  if (!decoded || typeof decoded !== "object") return null;
  const envelope = decoded as { ownerTag?: unknown; account?: unknown };
  if (envelope.ownerTag !== ownerTag) return null;
  return parsedStoredAccount(envelope.account, now);
}

function parsedStoredAccount(decoded: unknown, now: number): SklandStoredAccount | null {
  if (!decoded || typeof decoded !== "object") return null;
  const account = decoded as Partial<SklandStoredAccount>;
  const session = parsedSessionPayload(account.session, now);
  const roles = Array.isArray(account.roles) ? account.roles.map(parsedRole) : [];
  if (account.version !== 3 || !validAccountId(account.accountId) || !session || roles.some((role) => role === null) || roles.length === 0) return null;
  return { version: 3, accountId: account.accountId, session, roles: roles as SklandRole[] };
}

export function unsealSklandAccount(value: string, secret?: string, now = Date.now()): SklandStoredAccount | null {
  return parsedStoredAccount(unsealValue(value, secret), now);
}

export function sealSklandAccountIndex(index: SklandAccountIndexPayload, secret?: string): string {
  return sealValue(index, secret);
}

export function unsealSklandAccountIndex(value: string, secret?: string, now = Date.now()): SklandAccountIndexPayload | null {
  const decoded = unsealValue(value, secret);
  if (!decoded || typeof decoded !== "object") return null;
  const index = decoded as Partial<SklandAccountIndexPayload>;
  if (
    index.version !== 3 ||
    !Array.isArray(index.accountIds) ||
    index.accountIds.some((accountId) => !validAccountId(accountId)) ||
    new Set(index.accountIds).size !== index.accountIds.length ||
    index.accountIds.length > SKLAND_ACCOUNT_LIMIT ||
    (index.activeAccountId !== null && !validAccountId(index.activeAccountId)) ||
    (index.activeAccountId !== null && !index.accountIds.includes(index.activeAccountId)) ||
    typeof index.expiresAt !== "number" ||
    index.expiresAt <= now
  ) {
    return null;
  }
  return {
    version: 3,
    accountIds: index.accountIds,
    activeAccountId: index.activeAccountId ?? null,
    expiresAt: index.expiresAt,
  };
}

export function createSklandStoredAccount(
  session: SklandSessionPayload,
  roles: SklandRole[],
  accountId = randomBytes(12).toString("base64url")
): SklandStoredAccount {
  return {
    version: 3,
    accountId,
    session,
    roles: roles.map((role) => ({ ...role })),
  };
}

export function toPublicSklandAccount(account: SklandStoredAccount): SklandAccountSummary {
  return {
    accountId: account.accountId,
    selectedUid: account.session.selectedUid,
    roles: account.roles.map((role) => ({ ...role })),
    credentialExpiresAt: account.session.expiresAt,
  };
}

export function sklandDataOwnerTag(userId: string, secret?: string): string {
  return createHmac("sha256", keyFor(secret)).update(`skland:${userId}`).digest("hex");
}

export function sklandBindingKey(userId: string, secret?: string): string {
  return createHmac("sha256", keyFor(secret)).update(`binding:${userId}`).digest("hex");
}

export function upsertSklandAccount(
  accounts: SklandStoredAccount[],
  session: SklandSessionPayload,
  roles: SklandRole[]
): { accounts: SklandStoredAccount[]; account: SklandStoredAccount; replaced: boolean } {
  const existingIndex = accounts.findIndex((account) => account.session.userId === session.userId);
  if (existingIndex < 0 && accounts.length >= SKLAND_ACCOUNT_LIMIT) throw new SklandAccountLimitError();
  const account = createSklandStoredAccount(
    session,
    roles,
    existingIndex >= 0 ? accounts[existingIndex].accountId : undefined
  );
  if (existingIndex < 0) {
    return { accounts: [...accounts, account], account, replaced: false };
  }
  const next = accounts.slice();
  next[existingIndex] = account;
  return { accounts: next, account, replaced: true };
}

export function removeSklandAccount(
  accounts: SklandStoredAccount[],
  activeAccountId: string | null,
  accountId: string
): { accounts: SklandStoredAccount[]; activeAccountId: string | null } {
  const removedIndex = accounts.findIndex((account) => account.accountId === accountId);
  if (removedIndex < 0) return { accounts, activeAccountId };
  const next = accounts.filter((account) => account.accountId !== accountId);
  if (activeAccountId !== accountId) return { accounts: next, activeAccountId };
  return {
    accounts: next,
    activeAccountId: next[Math.min(removedIndex, next.length - 1)]?.accountId ?? null,
  };
}

export function isSecureSklandRequest(request: Request, nodeEnv = process.env.NODE_ENV): boolean {
  if (process.env.SKLAND_ALLOW_INSECURE_HTTP === "1") return true;

  const url = new URL(request.url);
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = (request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host") || url.host)
    .replace(/^\[/, "")
    .replace(/\](:\d+)?$/, "")
    .split(":")[0];
  const local = nodeEnv !== "production" && [url.hostname, host].some((hostname) => hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "0.0.0.0");
  return forwarded === "https" || url.protocol === "https:" || local;
}

function normalizedHttpOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function assertSameOrigin(request: Request, publicOrigin = process.env.SKLAND_PUBLIC_ORIGIN): void {
  const origin = request.headers.get("origin");
  if (!origin) return;

  const actualOrigin = normalizedHttpOrigin(origin);
  if (!actualOrigin) throw new Error("请求来源无效。");

  const configuredOrigin = publicOrigin?.trim();
  if (configuredOrigin) {
    const expectedOrigin = normalizedHttpOrigin(configuredOrigin);
    if (!expectedOrigin) {
      throw new Error("SKLAND_PUBLIC_ORIGIN 配置无效，必须是仅包含协议、主机和可选端口的 HTTP(S) Origin。");
    }
    if (actualOrigin !== expectedOrigin) throw new Error("请求来源无效。");
    return;
  }

  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const expectedHost = forwardedHost || request.headers.get("host") || requestUrl.host;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const expectedProtocol = forwardedProto || requestUrl.protocol.slice(0, -1);
  const expectedOrigin = normalizedHttpOrigin(`${expectedProtocol}://${expectedHost}`);
  if (!expectedOrigin || actualOrigin !== expectedOrigin) throw new Error("请求来源无效。");
}
