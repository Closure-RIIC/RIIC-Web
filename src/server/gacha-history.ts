import "server-only";

import { randomUUID } from "node:crypto";
import { createClient, STORAGE_DID_KEY, type Client } from "skland-kit";
import type { GachaHistory, GachaRecord } from "@/gacha-history";
import { mergeGachaRecords, parseGachaRecord } from "@/gacha-history";
import { DeviceIdCache } from "./skland/device-id-cache";
import { PublicApiError } from "./api-contract";
import { recentSklandOAuth } from "./skland/recent-oauth";
import type { SklandSessionPayload } from "./skland/session";
import { classifySklandUpstreamError } from "./skland/upstream-error";

const BINDING_ORIGIN = "https://binding-api-account-prod.hypergryph.com";
const GAME_ORIGIN = "https://ak.hypergryph.com";
const APP_CODE = "be36d44aa36bfb5b";
const SCAN_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 60 * 60_000;
const COOKIE = "aic_gacha_session";

type Scan = { client: Client; owner: string; createdAt: number; scanUrl: string; completed?: string };
type Role = { uid: string; nickname: string; token: string; cookie: string };
type Session = { owner: string; roles: Role[]; expiresAt: number };
export class GachaServiceError extends Error {}
export function publicGachaError(error: unknown) {
  return error instanceof GachaServiceError ? new PublicApiError("AIC-SYS-5000", { message: error.message }) : error;
}
const state = globalThis as typeof globalThis & {
  __aicGachaScans?: Map<string, Scan>;
  __aicGachaSessions?: Map<string, Session>;
  __aicGachaDeviceIdCache?: DeviceIdCache;
};
const scans = state.__aicGachaScans ??= new Map<string, Scan>();
const sessions = state.__aicGachaSessions ??= new Map<string, Session>();
const deviceIds = state.__aicGachaDeviceIdCache ??= new DeviceIdCache();

function cleanup() {
  const now = Date.now();
  for (const [key, scan] of scans) if (now - scan.createdAt > SCAN_TTL_MS) scans.delete(key);
  for (const [key, session] of sessions) if (session.expiresAt <= now) sessions.delete(key);
}

async function jsonRequest(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000), cache: "no-store", redirect: "error" });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || typeof body !== "object" || Array.isArray(body)) throw new GachaServiceError("鹰角账号服务暂不可用，请稍后重试。");
  const result = body as Record<string, unknown>;
  if (result.reason === "UN_LOGIN" || result.reason === "MissingCookie") throw new GachaServiceError("寻访授权已失效，请重新扫码。");
  if (typeof result.status === "number" && result.status !== 0) throw new GachaServiceError("鹰角账号授权失败，请重新扫码。");
  if (typeof result.code === "number" && result.code !== 0) throw new GachaServiceError("鹰角账号授权失败，请重新扫码。");
  return result;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function post(url: string, body: Record<string, unknown>) {
  return jsonRequest(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export async function startGachaScan(owner: string) {
  cleanup();
  for (const [id, scan] of scans) if (scan.owner === owner) scans.delete(id);
  const client = createClient({ timeout: 20_000 });
  const result = await deviceIds.run(client.storage, STORAGE_DID_KEY, () => client.collections.hypergryph.generateScanLoginUrl());
  scans.set(result.scanId, { client, owner, createdAt: Date.now(), scanUrl: result.scanUrl });
  return { scanId: result.scanId, scanUrl: result.scanUrl, expiresInSeconds: SCAN_TTL_MS / 1000 };
}

async function exchangeRoles(client: Client, accountToken: string): Promise<Role[]> {
  const grant = object(await client.collections.hypergryph.grantAuthorizeCode(accountToken, { appCode: APP_CODE, type: 1 }).catch((error: unknown) => {
    if (classifySklandUpstreamError(error) === "AUTH_EXPIRED") {
      throw new PublicApiError("AIC-AUTH-2008", { message: "寻访授权已失效，请点击“生成二维码”重新授权。" });
    }
    throw error;
  }));
  const oauthToken = String(grant.token ?? "");
  if (!oauthToken) throw new GachaServiceError("明日方舟用户中心未授权寻访记录，请重新扫码确认。");
  const query = new URLSearchParams({ token: oauthToken, appCode: "arknights" });
  const binding = object((await jsonRequest(`${BINDING_ORIGIN}/account/binding/v1/binding_list?${query}`)).data);
  const apps = Array.isArray(binding.list) ? binding.list : [];
  const entries = apps.flatMap((app) => {
    const row = object(app);
    return String(row.appCode ?? "").toLowerCase().includes("arknights") && Array.isArray(row.bindingList) ? row.bindingList : [];
  });
  if (!entries.length) throw new GachaServiceError("该账号下没有绑定明日方舟角色。");
  const roles: Role[] = [];
  for (const entry of entries.slice(0, 5)) {
    const value = object(entry);
    const uid = String(value.uid ?? "");
    if (!/^\d{4,20}$/.test(uid)) continue;
    const tokenData = object((await post(`${BINDING_ORIGIN}/account/binding/v1/u8_token_by_uid`, { uid, token: oauthToken })).data);
    const token = String(tokenData.token ?? "");
    if (!token) continue;
    const login = await fetch(`${GAME_ORIGIN}/user/api/role/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, source_from: "", share_type: "", share_by: "" }),
      signal: AbortSignal.timeout(20_000), cache: "no-store", redirect: "error",
    });
    if (!login.ok) continue;
    const cookie = login.headers.get("set-cookie")?.match(/(?:^|[,;]\s*)ak-user-center=([^;,]+)/)?.[1] ?? "";
    if (cookie) roles.push({ uid, nickname: String(value.nickname ?? value.nickName ?? uid).slice(0, 80), token, cookie });
  }
  if (!roles.length) throw new GachaServiceError("明日方舟寻访授权未完成，请重新扫码。");
  return roles;
}

export async function pollGachaScan(scanId: string, owner: string) {
  cleanup();
  const scan = scans.get(scanId);
  if (!scan || scan.owner !== owner) return { status: "expired" as const };
  if (scan.completed) return { status: "authenticated" as const, sessionId: scan.completed, roles: sessions.get(scan.completed)?.roles.map(({ uid, nickname }) => ({ uid, nickname })) ?? [] };
  const status = await scan.client.collections.hypergryph.getScanStatus(scanId).catch((error: unknown) => {
    const cause = object(error instanceof Error ? error.cause : null);
    const code = Number(cause.status);
    if (code === 100 || code === 101 || code === 102) return { scanCode: "", scanStatus: code === 102 ? "expired" : code === 101 ? "scanned" : "waiting" };
    throw new GachaServiceError("扫码状态读取失败，请稍后再试。");
  });
  if (!status.scanCode) {
    const label = String(status.scanStatus).toLowerCase();
    return { status: label.includes("expire") ? "expired" as const : label.includes("scan") || label.includes("confirm") ? "scanned" as const : "waiting" as const };
  }
  const accountToken = await scan.client.collections.hypergryph.getOAuthTokenByScanCode(status.scanCode);
  const roles = await exchangeRoles(scan.client, accountToken);
  const sessionId = randomUUID();
  sessions.set(sessionId, { owner, roles, expiresAt: Date.now() + SESSION_TTL_MS });
  scan.completed = sessionId;
  return { status: "authenticated" as const, sessionId, roles: roles.map(({ uid, nickname }) => ({ uid, nickname })) };
}

export function gachaCookieName() { return COOKIE; }

export async function authorizeGachaFromSkland(owner: string, skland: SklandSessionPayload) {
  cleanup();
  const token = skland.accountOAuthToken ?? recentSklandOAuth.get(owner, skland.cred);
  if (!token) throw new PublicApiError("AIC-AUTH-2008", { message: "当前森空岛登录未保存寻访所需的授权，请点击“生成二维码”完成授权。" });
  const client = createClient({ timeout: 20_000 });
  await client.storage.setItem(STORAGE_DID_KEY, skland.dId);
  const roles = await exchangeRoles(client, token);
  if (!roles.some((role) => role.uid === skland.selectedUid)) throw new GachaServiceError("寻访授权与当前森空岛角色不一致，请重新扫码。");
  const sessionId = randomUUID();
  const session = { owner, roles, expiresAt: Date.now() + SESSION_TTL_MS };
  sessions.set(sessionId, session);
  return { sessionId, roles: publicGachaRoles(session), selectedUid: skland.selectedUid };
}

export function publicGachaRoles(session: Session) {
  return session.roles.map(({ uid, nickname }) => ({ uid, nickname }));
}

export function revokeGachaSession(request: Request) {
  const id = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (id) sessions.delete(id);
}

export function gachaSession(request: Request, owner: string): Session | null {
  cleanup();
  const id = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  const session = id ? sessions.get(id) : null;
  return session?.owner === owner ? session : null;
}

async function historyPage(role: Role, category: string, pos?: string, gachaTs?: string) {
  const query = new URLSearchParams({ uid: role.uid, category, size: "50" });
  if (pos !== undefined && gachaTs !== undefined) { query.set("pos", pos); query.set("gachaTs", gachaTs); }
  const response = await jsonRequest(`${GAME_ORIGIN}/user/api/inquiry/gacha/history?${query}`, {
    headers: { "x-role-token": role.token, Cookie: `ak-user-center=${role.cookie}`, Referer: `${GAME_ORIGIN}/` },
  });
  return object(response.data);
}

export async function fetchGachaHistory(session: Session, uid: string): Promise<GachaHistory> {
  const role = session.roles.find((item) => item.uid === uid);
  if (!role) throw new GachaServiceError("扫码账号与当前森空岛角色不一致，请切换角色或用对应账号扫码。");
  const response = await jsonRequest(`${GAME_ORIGIN}/user/api/inquiry/gacha/cate?${new URLSearchParams({ uid: role.uid })}`, {
    headers: { "x-role-token": role.token, Cookie: `ak-user-center=${role.cookie}`, Referer: `${GAME_ORIGIN}/` },
  });
  const data = response.data;
  const categories = (Array.isArray(data) ? data : Array.isArray(object(data).list) ? object(data).list as unknown[] : [])
    .map(object).map((item) => String(item.id ?? "")).filter((id) => id && id.length < 100).slice(0, 30);
  if (!categories.length) throw new GachaServiceError("寻访接口没有返回卡池分类。");
  let records: GachaRecord[] = [];
  const warnings: string[] = [];
  for (const category of categories) {
    try {
      let cursor: string | undefined;
      let pos: string | undefined;
      for (let page = 0; page < 30; page += 1) {
        const data = await historyPage(role, category, pos, cursor);
        const list = Array.isArray(data.list) ? data.list : [];
        if (!list.length) break;
        records = mergeGachaRecords(records, list.map((row) => parseGachaRecord(row, category)).filter((row): row is GachaRecord => row !== null));
        if (data.hasMore !== true) break;
        const last = object(list[list.length - 1]);
        const nextCursor = String(last.gachaTs ?? "");
        const nextPos = String(last.pos ?? "");
        if (!nextCursor || (nextCursor === cursor && nextPos === pos)) break;
        cursor = nextCursor; pos = nextPos;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    } catch {
      warnings.push(`${category} 读取失败，可稍后刷新补齐。`);
    }
  }
  if (!records.length && warnings.length) throw new GachaServiceError("寻访记录读取失败，请重新扫码或稍后重试。");
  return { uid: role.uid, nickname: role.nickname, records, warnings, fetchedAt: new Date().toISOString() };
}
