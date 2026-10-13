import { createHash } from "node:crypto";

import {
  createClient,
  STORAGE_CREDENTIAL_KEY,
  STORAGE_DID_KEY,
  STORAGE_OAUTH_TOKEN_KEY,
  STORAGE_USER_ID_KEY,
  type Client,
} from "skland-kit";

import type { SklandInventoryData, SklandQrStatusResponse, SklandScheduleSnapshot, SklandStatusSnapshot } from "@/types";
import type { SklandPolicyConsentRequest } from "@/legal-policy";
import { DeviceIdCache } from "./device-id-cache";
import { recentSklandOAuth } from "./recent-oauth";
import {
  SKLAND_TEENAGER_PATH,
  mowerSklandSignedHeaders,
  sklandSignedHeaders,
  stableSklandUserIdFromResponse,
} from "./credential";
import { rolesFromBinding, snapshotFromPlayerInfo, snapshotsFromPlayerInfo } from "./normalize";
import { persistOperatorSnapshot } from "./operator-snapshot-store";
import { inventoryItemsFromResponse } from "./inventory-parser";
import { sklandLayoutSuggestion } from "./layout-suggestion";
import {
  SKLAND_SESSION_TTL_SECONDS,
  type SklandPolicyConsent,
  type SklandSessionPayload,
} from "./session";
import {
  findOwnedScan,
  findReusableScan,
  hasScanStartCapacity,
  scanActorKey,
  SCAN_TTL_MS,
  type ScanStartResult,
} from "./scan-admission";
import {
  classifySklandUpstreamError,
  SKLAND_UPSTREAM_COOLDOWN_MS,
  type SklandServiceErrorCode,
} from "./upstream-error";

const SCAN_TTL_SECONDS = SCAN_TTL_MS / 1000;
const TOKEN_REFRESH_MS = 20 * 60 * 1000;

type PendingScan = {
  client: Client;
  actorKey: string;
  scanUrl: string;
  createdAt: number;
  lastPollAt: number;
  policyConsent: SklandPolicyConsent;
  completed?: CompletedSklandAuthentication;
};

type RateEntry = { timestamps: number[] };

export interface CompletedSklandAuthentication {
  session: SklandSessionPayload;
  snapshot: SklandScheduleSnapshot;
  statusSnapshot: SklandStatusSnapshot;
}

declare global {
  var __infraCalcSklandScans: Map<string, PendingScan> | undefined;
  var __infraCalcSklandRate: Map<string, RateEntry> | undefined;
  var __infraCalcSklandScanStarts: Map<string, Promise<ScanStartResult>> | undefined;
  var __infraCalcSklandDeviceIdCache: DeviceIdCache | undefined;
  var __infraCalcSklandUpstreamCooldownUntil: number | undefined;
}

const pendingScans = globalThis.__infraCalcSklandScans ?? new Map<string, PendingScan>();
const rateEntries = globalThis.__infraCalcSklandRate ?? new Map<string, RateEntry>();
const scanStartTasks = globalThis.__infraCalcSklandScanStarts ?? new Map<string, Promise<ScanStartResult>>();
const deviceIdCache = globalThis.__infraCalcSklandDeviceIdCache ?? new DeviceIdCache();
globalThis.__infraCalcSklandScans = pendingScans;
globalThis.__infraCalcSklandRate = rateEntries;
globalThis.__infraCalcSklandScanStarts = scanStartTasks;
globalThis.__infraCalcSklandDeviceIdCache = deviceIdCache;

export class SklandServiceError extends Error {
  constructor(
    public readonly code: SklandServiceErrorCode,
    message: string,
    public readonly status = 500
  ) {
    super(message);
  }
}

function upstreamRetryAfterSeconds(now = Date.now()): number {
  return Math.max(0, Math.ceil(((globalThis.__infraCalcSklandUpstreamCooldownUntil ?? 0) - now) / 1000));
}

function assertUpstreamCapacity(now = Date.now()): void {
  if (upstreamRetryAfterSeconds(now) > 0) {
    throw new SklandServiceError("RATE_LIMITED", "森空岛请求正在冷却，请稍后再试。", 429);
  }
}

function beginUpstreamCooldown(now = Date.now()): void {
  globalThis.__infraCalcSklandUpstreamCooldownUntil = Math.max(
    globalThis.__infraCalcSklandUpstreamCooldownUntil ?? 0,
    now + SKLAND_UPSTREAM_COOLDOWN_MS,
  );
}

function cleanupScans(now = Date.now()): void {
  for (const [scanId, scan] of pendingScans) {
    if (now - scan.createdAt > SCAN_TTL_MS) pendingScans.delete(scanId);
  }
  for (const [key, entry] of rateEntries) {
    const timestamps = entry.timestamps.filter((timestamp) => now - timestamp < SCAN_TTL_MS);
    if (timestamps.length === 0) rateEntries.delete(key);
    else rateEntries.set(key, { timestamps });
  }
}

function assertRate(key: string, limit: number, windowMs: number, now = Date.now()): void {
  const current = rateEntries.get(key)?.timestamps.filter((timestamp) => now - timestamp < windowMs) ?? [];
  if (current.length >= limit) throw new SklandServiceError("RATE_LIMITED", "操作过于频繁，请稍后再试。", 429);
  current.push(now);
  rateEntries.set(key, { timestamps: current });
}

export function assertScanStartCapacity(activeStarts: number): void {
  if (!hasScanStartCapacity(activeStarts)) {
    throw new SklandServiceError("RATE_LIMITED", "二维码生成请求正在排队，请稍后再试。", 429);
  }
}

function publicError(error: unknown): SklandServiceError {
  if (error instanceof SklandServiceError) return error;
  const classification = classifySklandUpstreamError(error);
  if (classification === "AUTH_EXPIRED") return new SklandServiceError("AUTH_EXPIRED", "森空岛登录已失效，请重新授权。", 401);
  if (classification === "RATE_LIMITED") {
    beginUpstreamCooldown();
    return new SklandServiceError("RATE_LIMITED", "森空岛请求过于频繁，请稍后再试。", 429);
  }
  return new SklandServiceError("UNAVAILABLE", "森空岛暂时不可用，请稍后重试；MAA 导入仍可正常使用。", 502);
}

export function scanStatusFromError(error: unknown): "waiting" | "scanned" | "expired" | null {
  const cause = error && typeof error === "object" && "cause" in error ? (error as { cause?: unknown }).cause : null;
  if (!cause || typeof cause !== "object" || !("status" in cause)) return null;
  const status = Number((cause as { status?: unknown }).status);
  if (status === 100) return "waiting";
  if (status === 101) return "scanned";
  if (status === 102) return "expired";
  return null;
}

function scanDisplayStatus(raw: string): "waiting" | "scanned" | "expired" {
  const value = raw.toLowerCase();
  if (/expire|invalid|失效|过期|-1/.test(value)) return "expired";
  if (/scanned|confirm|已扫码|待确认/.test(value) || value === "1") return "scanned";
  return "waiting";
}

async function seedClient(payload: SklandSessionPayload): Promise<Client> {
  const client = createClient({ timeout: 30_000 });
  await client.storage.setItems([
    { key: STORAGE_CREDENTIAL_KEY, value: payload.cred },
    { key: STORAGE_OAUTH_TOKEN_KEY, value: payload.token },
    { key: STORAGE_DID_KEY, value: payload.dId },
    { key: STORAGE_USER_ID_KEY, value: payload.userId },
  ]);
  return client;
}

async function refreshedPayload(client: Client, payload: SklandSessionPayload, force = false): Promise<SklandSessionPayload> {
  if (!force && Date.now() - payload.refreshedAt < TOKEN_REFRESH_MS) return payload;
  const { token } = await client.refresh();
  return { ...payload, token, refreshedAt: Date.now() };
}

async function scheduleWithClient(client: Client, payload: SklandSessionPayload): Promise<{
  payload: SklandSessionPayload;
  snapshot: SklandScheduleSnapshot;
  statusSnapshot: SklandStatusSnapshot;
}> {
  const binding = await client.collections.player.getBinding();
  const roles = rolesFromBinding(binding);
  if (roles.length === 0) throw new SklandServiceError("BAD_DATA", "该森空岛账号没有绑定可用的明日方舟角色。", 422);
  const selectedUid = roles.some((role) => role.uid === payload.selectedUid)
    ? payload.selectedUid
    : roles.find((role) => role.isDefault)?.uid ?? roles[0].uid;
  const info = await client.collections.player.getInfo({ uid: selectedUid });
  const snapshots = snapshotsFromPlayerInfo(info, roles, selectedUid, sklandLayoutSuggestion(info));
  void persistOperatorSnapshot(snapshots.statusSnapshot);
  return {
    payload: { ...payload, selectedUid },
    snapshot: snapshots.scheduleSnapshot,
    statusSnapshot: snapshots.statusSnapshot,
  };
}

async function completeOAuthLogin(
  client: Client,
  oauthToken: string,
  policyConsent: SklandPolicyConsent
): Promise<CompletedSklandAuthentication> {
  const grant = await client.collections.hypergryph.grantAuthorizeCode(oauthToken);
  const auth = await client.signIn(grant.code);
  const binding = await client.collections.player.getBinding();
  const roles = rolesFromBinding(binding);
  if (roles.length === 0) {
    throw new SklandServiceError("BAD_DATA", "该森空岛账号没有绑定可用的明日方舟角色。", 422);
  }
  const selectedUid = roles.find((role) => role.isDefault)?.uid ?? roles[0].uid;
  const info = await client.collections.player.getInfo({ uid: selectedUid });
  const dId = (await client.storage.getItem(STORAGE_DID_KEY)) ?? "";
  if (!dId) throw new SklandServiceError("BAD_DATA", "森空岛设备凭证生成失败。", 502);
  const session: SklandSessionPayload = {
    version: 3,
    cred: auth.cred,
    token: auth.token,
    accountOAuthToken: oauthToken,
    dId,
    userId: auth.userId,
    selectedUid,
    refreshedAt: Date.now(),
    expiresAt: Date.now() + SKLAND_SESSION_TTL_SECONDS * 1000,
    policyConsent,
  };
  const snapshots = snapshotsFromPlayerInfo(info, roles, selectedUid, sklandLayoutSuggestion(info));
  void persistOperatorSnapshot(snapshots.statusSnapshot);
  return {
    session,
    snapshot: snapshots.scheduleSnapshot,
    statusSnapshot: snapshots.statusSnapshot,
  };
}

function upstreamResponseCode(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const code = Number((value as { code?: unknown }).code);
  return Number.isFinite(code) ? code : null;
}

async function stableUserId(
  client: Client,
  credential: { cred: string; token: string; dId: string },
): Promise<string> {
  const response = await client.$fetch<unknown>(SKLAND_TEENAGER_PATH, {
    headers: sklandSignedHeaders({
      ...credential,
      path: SKLAND_TEENAGER_PATH,
    }),
  });
  const userId = stableSklandUserIdFromResponse(response);
  if (userId) return userId;
  const code = upstreamResponseCode(response);
  if (code === 10000 || code === 10001 || code === 10002) {
    throw new SklandServiceError("AUTH_EXPIRED", "森空岛凭证已失效，请重新授权。", 401);
  }
  throw new SklandServiceError("BAD_DATA", "无法确认森空岛账号身份，已拒绝导入。", 502);
}

async function refreshCredentialClient(client: Client): Promise<{ token: string }> {
  try {
    const refreshed = await client.refresh();
    if (typeof refreshed.token === "string" && refreshed.token.trim()) return refreshed;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
  }

  // skland-kit 0.3.5 reads refresh.data.token before validating the upstream
  // envelope. Probe a signed read so an expired credential still receives the
  // public authentication error instead of being misreported as a server fault.
  await client.collections.player.getBinding();
  throw new SklandServiceError("UNAVAILABLE", "森空岛未返回可用的刷新 token。", 502);
}

export async function authenticateSklandCredential(
  credential: { cred: string; token: string },
  policyConsent: SklandPolicyConsent,
): Promise<CompletedSklandAuthentication> {
  try {
    assertUpstreamCapacity();
    const client = createClient({ timeout: 30_000 });
    await client.storage.setItems([
      { key: STORAGE_CREDENTIAL_KEY, value: credential.cred },
      { key: STORAGE_OAUTH_TOKEN_KEY, value: credential.token },
    ]);

    const refreshed = await refreshCredentialClient(client);
    const dId = (await client.storage.getItem(STORAGE_DID_KEY)) ?? "";
    if (!dId) throw new SklandServiceError("BAD_DATA", "森空岛设备凭证生成失败。", 502);

    const binding = await client.collections.player.getBinding();
    const roles = rolesFromBinding(binding);
    if (roles.length === 0) {
      throw new SklandServiceError("BAD_DATA", "该森空岛账号没有绑定可用的明日方舟角色。", 422);
    }
    const userId = await stableUserId(client, {
      cred: credential.cred,
      token: refreshed.token,
      dId,
    });
    const selectedUid = roles.find((role) => role.isDefault)?.uid ?? roles[0].uid;
    const info = await client.collections.player.getInfo({ uid: selectedUid });
    const authorizedAt = Date.now();
    const session: SklandSessionPayload = {
      version: 3,
      cred: credential.cred,
      token: refreshed.token,
      dId,
      userId,
      selectedUid,
      refreshedAt: authorizedAt,
      expiresAt: authorizedAt + SKLAND_SESSION_TTL_SECONDS * 1000,
      policyConsent,
    };
    const snapshots = snapshotsFromPlayerInfo(info, roles, selectedUid, sklandLayoutSuggestion(info));
    void persistOperatorSnapshot(snapshots.statusSnapshot);
    return {
      session,
      snapshot: snapshots.scheduleSnapshot,
      statusSnapshot: snapshots.statusSnapshot,
    };
  } catch (error) {
    throw publicError(error);
  }
}

export function requestIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function startScan(
  websiteUserId: string,
  ip: string,
  consent: SklandPolicyConsentRequest
): Promise<ScanStartResult> {
  cleanupScans();
  const actorKey = scanActorKey(websiteUserId);
  const reusable = findReusableScan(pendingScans, actorKey, consent);
  if (reusable) return reusable;

  const activeTask = scanStartTasks.get(actorKey);
  if (activeTask) return activeTask;

  assertScanStartCapacity(scanStartTasks.size);
  assertRate(`scan:actor:${actorKey}`, 5, 10 * 60 * 1000);
  assertRate(`scan:ip:${ip}`, 10, 10 * 60 * 1000);

  const task = createScan(actorKey, consent);
  scanStartTasks.set(actorKey, task);
  try {
    return await task;
  } finally {
    if (scanStartTasks.get(actorKey) === task) scanStartTasks.delete(actorKey);
  }
}

async function createScan(
  actorKey: string,
  consent: SklandPolicyConsentRequest
): Promise<ScanStartResult> {
  try {
    const client = createClient({ timeout: 30_000 });
    const result = await deviceIdCache.run(
      client.storage,
      STORAGE_DID_KEY,
      () => client.collections.hypergryph.generateScanLoginUrl()
    );
    const createdAt = Date.now();
    pendingScans.set(result.scanId, {
      client,
      actorKey,
      scanUrl: result.scanUrl,
      createdAt,
      lastPollAt: 0,
      policyConsent: {
        termsVersion: consent.termsVersion,
        privacyVersion: consent.privacyVersion,
        acceptedAt: createdAt,
      },
    });
    return { ...result, expiresInSeconds: SCAN_TTL_SECONDS };
  } catch (error) {
    throw publicError(error);
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

function completedScanResult(completed: CompletedSklandAuthentication): {
  response: SklandQrStatusResponse;
  session: SklandSessionPayload;
} {
  return {
    response: {
      success: true,
      status: "authenticated",
      scheduleSnapshot: completed.snapshot,
      statusSnapshot: completed.statusSnapshot,
    },
    session: completed.session,
  };
}

export function consumeScan(scanId: string, websiteUserId: string): void {
  if (findOwnedScan(pendingScans, scanId, websiteUserId)) pendingScans.delete(scanId);
}

export async function pollScan(scanId: string, websiteUserId: string, signal?: AbortSignal): Promise<{
  response: SklandQrStatusResponse;
  session?: SklandSessionPayload;
}> {
  cleanupScans();
  throwIfAborted(signal);
  const pending = findOwnedScan(pendingScans, scanId, websiteUserId);
  if (!pending) return { response: { success: false, status: "expired", error: "二维码已失效，请刷新后重试。", code: "AUTH_EXPIRED" } };
  if (pending.completed) return completedScanResult(pending.completed);
  const now = Date.now();
  if (now - pending.lastPollAt < 1_000) return { response: { success: true, status: "waiting" } };
  pending.lastPollAt = now;
  try {
    const status = await pending.client.collections.hypergryph.getScanStatus(scanId);
    throwIfAborted(signal);
    if (!status.scanCode) return { response: { success: true, status: scanDisplayStatus(status.scanStatus ?? "") } };

    const oauthToken = await pending.client.collections.hypergryph.getOAuthTokenByScanCode(status.scanCode);
    throwIfAborted(signal);
    assertUpstreamCapacity();
    const completed = await completeOAuthLogin(pending.client, oauthToken, pending.policyConsent);
    throwIfAborted(signal);
    recentSklandOAuth.remember(websiteUserId, completed.session.cred, oauthToken);
    pending.completed = completed;
    return completedScanResult(completed);
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    const status = scanStatusFromError(error);
    if (status) {
      if (status === "expired") pendingScans.delete(scanId);
      return {
        response: {
          success: status !== "expired",
          status,
          ...(status === "expired" ? { error: "二维码已失效，请刷新后重试。", code: "AUTH_EXPIRED" } : {}),
        },
      };
    }
    const known = publicError(error);
    if (known.code === "AUTH_EXPIRED") pendingScans.delete(scanId);
    throw known;
  }
}

export async function loadSessionSnapshot(payload: SklandSessionPayload, forceRefresh = false): Promise<{
  session: SklandSessionPayload;
  snapshot: SklandScheduleSnapshot;
  statusSnapshot: SklandStatusSnapshot;
}> {
  try {
    assertUpstreamCapacity();
    const client = await seedClient(payload);
    const refreshed = await refreshedPayload(client, payload, forceRefresh);
    if (refreshed.token !== payload.token) await client.storage.setItem(STORAGE_OAUTH_TOKEN_KEY, refreshed.token);
    const result = await scheduleWithClient(client, refreshed);
    return {
      session: result.payload,
      snapshot: result.snapshot,
      statusSnapshot: result.statusSnapshot,
    };
  } catch (error) {
    throw publicError(error);
  }
}

export async function syncSessionSnapshot(payload: SklandSessionPayload): Promise<{
  session: SklandSessionPayload;
  snapshot: SklandScheduleSnapshot;
  statusSnapshot: SklandStatusSnapshot;
}> {
  const key = createHash("sha256").update(payload.cred).digest("hex").slice(0, 24);
  assertRate(`sync:${key}`, 30, 60 * 60_000);
  return loadSessionSnapshot(payload, true);
}

export async function selectSessionRole(payload: SklandSessionPayload, uid: string): Promise<{
  session: SklandSessionPayload;
  snapshot: SklandScheduleSnapshot;
  statusSnapshot: SklandStatusSnapshot;
}> {
  if (!uid.trim()) throw new SklandServiceError("BAD_DATA", "缺少要切换的角色 UID。", 400);
  return loadSessionSnapshot({ ...payload, selectedUid: uid.trim() });
}

export async function loadStatusSnapshot(payload: SklandSessionPayload): Promise<{
  session: SklandSessionPayload;
  snapshot: SklandStatusSnapshot;
}> {
  try {
    assertUpstreamCapacity();
    const client = await seedClient(payload);
    const refreshed = await refreshedPayload(client, payload);
    if (refreshed.token !== payload.token) await client.storage.setItem(STORAGE_OAUTH_TOKEN_KEY, refreshed.token);
    const binding = await client.collections.player.getBinding();
    const roles = rolesFromBinding(binding);
    if (roles.length === 0) throw new SklandServiceError("BAD_DATA", "该森空岛账号没有绑定可用的明日方舟角色。", 422);
    const selectedUid = roles.some((role) => role.uid === refreshed.selectedUid)
      ? refreshed.selectedUid
      : roles.find((role) => role.isDefault)?.uid ?? roles[0].uid;
    const info = await client.collections.player.getInfo({ uid: selectedUid });
    return {
      session: { ...refreshed, selectedUid },
      snapshot: snapshotFromPlayerInfo(info, roles, selectedUid, sklandLayoutSuggestion(info)),
    };
  } catch (error) {
    throw publicError(error);
  }
}

export async function loadInventorySnapshot(payload: SklandSessionPayload): Promise<{
  session: SklandSessionPayload;
  inventory: Omit<SklandInventoryData, "identityKey">;
}> {
  try {
    assertUpstreamCapacity();
    const client = await seedClient(payload);
    const refreshed = await refreshedPayload(client, payload);
    if (refreshed.token !== payload.token) await client.storage.setItem(STORAGE_OAUTH_TOKEN_KEY, refreshed.token);
    if (!refreshed.selectedUid) throw new SklandServiceError("BAD_DATA", "森空岛没有可读取的角色。", 422);

    const path = "/api/v1/game/cultivate/player";
    const loadRawInventory = async (uid: string): Promise<{ code?: unknown; data?: unknown }> => {
      const query = new URLSearchParams({ uid }).toString();
      const response = await fetch(`https://zonai.skland.com${path}?${query}`, {
        headers: mowerSklandSignedHeaders({
          cred: refreshed.cred,
          token: refreshed.token,
          path,
          query,
        }),
        signal: AbortSignal.timeout(30_000),
      }).then(async (result) => {
        const body = await result.json() as unknown;
        if (!result.ok) throw new Error(`森空岛库存请求失败：${result.status}`);
        return body;
      });
      return response && typeof response === "object" ? response as { code?: unknown; data?: unknown } : {};
    };

    const record = await loadRawInventory(refreshed.selectedUid);
    if (Number(record.code) !== 0) throw new SklandServiceError("AUTH_EXPIRED", "森空岛库存读取失败，请重新授权。", 401);
    const items = inventoryItemsFromResponse(record.data);


    return {
      session: refreshed,
      inventory: {
        items,
        fetchedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    throw publicError(error);
  }
}
