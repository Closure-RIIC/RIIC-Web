import { getCookies, getRequestHeaders } from "../request-context";
import { setResponseCookie } from "../response-cookies";

import { isSklandFeatureEnabled } from "@riic/arknights-domain/deployment";
import type { SklandAccountSummary, SklandScheduleSnapshot, SklandStatusSnapshot } from "@riic/arknights-domain/types";
import { failureResponse, PublicApiError } from "../api-contract";
import { websiteSession } from "../auth";
import { SklandBindingConflictError } from "./bindings";
import { loadSessionSnapshot, SklandServiceError } from "./adapter";
import {
  createSklandStoredAccount,
  isSecureSklandRequest,
  isSklandConfigured,
  removeSklandAccount,
  sealOwnedSklandAccount,
  sealSklandAccountIndex,
  LEGACY_SKLAND_ACCOUNT_COOKIE_PREFIX,
  LEGACY_SKLAND_ACCOUNT_INDEX_COOKIE,
  SKLAND_ACCOUNT_COOKIE_PREFIX,
  SKLAND_ACCOUNT_INDEX_COOKIE,
  SKLAND_ACCOUNT_LIMIT,
  SKLAND_SESSION_COOKIE,
  SKLAND_SESSION_TTL_SECONDS,
  sklandAccountCookieName,
  toPublicSklandAccount,
  type SklandStoredAccount,
  type SklandSessionPayload,
  unsealOwnedSklandAccount,
  unsealSklandAccountIndex,
  websiteUserOwnerTag,
} from "./session";
import { publicCodeForSklandServiceError } from "./http-error";

export interface SklandAccountStore {
  accounts: SklandStoredAccount[];
  activeAccountId: string | null;
  staleCookieNames: string[];
  migratedSnapshot: {
    schedule: SklandScheduleSnapshot;
    status: SklandStatusSnapshot;
  } | null;
  websiteOwnerTag: string | null;
}

function cookieOptions(request: Request, maxAge = SKLAND_SESSION_TTL_SECONDS) {
  const url = new URL(request.url);
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: forwarded === "https" || url.protocol === "https:",
    maxAge,
    path: "/",
  };
}

export async function readSklandAccountStore(verifiedWebsiteUserId?: string): Promise<SklandAccountStore> {
  const websiteUserId = verifiedWebsiteUserId ?? (await websiteSession(getRequestHeaders()))?.user.id;
  const websiteOwnerTag = websiteUserId ? websiteUserOwnerTag(websiteUserId) : null;
  if (!websiteOwnerTag) return { accounts: [], activeAccountId: null, staleCookieNames: [], migratedSnapshot: null, websiteOwnerTag: null };
  if (!isSklandConfigured()) {
    return { accounts: [], activeAccountId: null, staleCookieNames: [], migratedSnapshot: null, websiteOwnerTag };
  }
  const cookieValues = getCookies();
  const allCookies = Object.entries(cookieValues).map(([name, value]) => ({ name, value }));
  const store = { get: (name: string) => allCookies.find((cookie) => cookie.name === name) };
  const indexCookie = store.get(SKLAND_ACCOUNT_INDEX_COOKIE);
  const index = indexCookie ? unsealSklandAccountIndex(indexCookie.value) : null;
  const staleCookieNames = [
    ...(indexCookie && !index ? [SKLAND_ACCOUNT_INDEX_COOKIE] : []),
    ...(store.get(LEGACY_SKLAND_ACCOUNT_INDEX_COOKIE) ? [LEGACY_SKLAND_ACCOUNT_INDEX_COOKIE] : []),
    ...allCookies
      .map((cookie) => cookie.name)
      .filter((name) => name.startsWith(LEGACY_SKLAND_ACCOUNT_COOKIE_PREFIX)),
  ];
  const byName = new Map(allCookies.map((cookie) => [cookie.name, cookie.value]));
  const indexedNames = index?.accountIds.map(sklandAccountCookieName) ?? [];
  const extraNames = allCookies
    .map((cookie) => cookie.name)
    .filter((name) => name.startsWith(SKLAND_ACCOUNT_COOKIE_PREFIX) && !indexedNames.includes(name));
  const accountNames = [...indexedNames, ...extraNames];
  const accounts: SklandStoredAccount[] = [];

  for (const name of accountNames) {
    const value = byName.get(name);
    const account = value ? unsealOwnedSklandAccount(value, websiteOwnerTag) : null;
    if (!account || sklandAccountCookieName(account.accountId) !== name) {
      staleCookieNames.push(name);
      continue;
    }
    if (
      accounts.length >= SKLAND_ACCOUNT_LIMIT ||
      accounts.some((current) =>
        current.accountId === account.accountId ||
        current.session.userId === account.session.userId
      )
    ) {
      staleCookieNames.push(name);
      continue;
    }
    accounts.push(account);
  }

  const legacyValue = store.get(SKLAND_SESSION_COOKIE)?.value;
  if (legacyValue) staleCookieNames.push(SKLAND_SESSION_COOKIE);

  const activeAccountId = accounts.some((account) => account.accountId === index?.activeAccountId)
    ? index?.activeAccountId ?? null
    : accounts[0]?.accountId ?? null;
  return {
    accounts,
    activeAccountId,
    staleCookieNames: [...new Set(staleCookieNames)],
    migratedSnapshot: null,
    websiteOwnerTag,
  };
}

export function activeSklandAccount(store: SklandAccountStore): SklandStoredAccount | null {
  return store.accounts.find((account) => account.accountId === store.activeAccountId) ?? null;
}

export function sklandAccountSummaries(store: SklandAccountStore): SklandAccountSummary[] {
  return store.accounts.map(toPublicSklandAccount);
}

export function withUpdatedSklandAccount(
  store: SklandAccountStore,
  accountId: string,
  session: SklandSessionPayload,
  snapshot: SklandScheduleSnapshot
): SklandAccountStore {
  return {
    ...store,
    accounts: store.accounts.map((account) => account.accountId === accountId
      ? createSklandStoredAccount(session, snapshot.roles, accountId)
      : account),
    activeAccountId: accountId,
    migratedSnapshot: null,
  };
}

export async function loadActiveSklandAccount(
  store: SklandAccountStore,
  forceRefresh = false
): Promise<{
  store: SklandAccountStore;
  snapshot: SklandScheduleSnapshot | null;
  statusSnapshot: SklandStatusSnapshot | null;
}> {
  let current = store;
  while (current.activeAccountId) {
    const account = activeSklandAccount(current);
    if (!account) {
      current = { ...current, activeAccountId: current.accounts[0]?.accountId ?? null };
      continue;
    }
    if (current.migratedSnapshot && !forceRefresh) {
      return {
        store: current,
        snapshot: current.migratedSnapshot.schedule,
        statusSnapshot: current.migratedSnapshot.status,
      };
    }
    try {
      const result = await loadSessionSnapshot(account.session, forceRefresh);
      const updated = withUpdatedSklandAccount(current, account.accountId, result.session, result.snapshot);
      return {
        store: updated,
        snapshot: result.snapshot,
        statusSnapshot: result.statusSnapshot,
      };
    } catch (error) {
      if (!(error instanceof SklandServiceError) || error.code !== "AUTH_EXPIRED") throw error;
      const removed = removeSklandAccount(current.accounts, current.activeAccountId, account.accountId);
      current = {
        ...current,
        accounts: removed.accounts,
        activeAccountId: removed.activeAccountId,
        migratedSnapshot: null,
      };
    }
  }
  return { store: current, snapshot: null, statusSnapshot: null };
}

export function setSklandAccountStoreCookies(
  response: Response,
  request: Request,
  store: SklandAccountStore,
  previous?: SklandAccountStore
): void {
  if (!store.websiteOwnerTag) throw new PublicApiError("AIC-AUTH-2008");
  response.headers.set("Cache-Control", "private, no-store");
  const currentNames = new Set(store.accounts.map((account) => sklandAccountCookieName(account.accountId)));
  const removedNames = [
    ...(previous?.accounts.map((account) => sklandAccountCookieName(account.accountId)) ?? []),
    ...(previous?.staleCookieNames ?? []),
    ...store.staleCookieNames,
  ].filter((name) => (
    name.startsWith(SKLAND_ACCOUNT_COOKIE_PREFIX)
    || name.startsWith(LEGACY_SKLAND_ACCOUNT_COOKIE_PREFIX)
  ) && !currentNames.has(name));

  for (const name of new Set(removedNames)) {
    setResponseCookie(response, name, "", cookieOptions(request, 0));
  }
  setResponseCookie(response, SKLAND_SESSION_COOKIE, "", cookieOptions(request, 0));
  setResponseCookie(response, LEGACY_SKLAND_ACCOUNT_INDEX_COOKIE, "", cookieOptions(request, 0));

  if (store.accounts.length === 0) {
    setResponseCookie(response, SKLAND_ACCOUNT_INDEX_COOKIE, "", cookieOptions(request, 0));
    return;
  }

  const now = Date.now();
  const latestExpiry = Math.max(...store.accounts.map((account) => account.session.expiresAt));
  const indexMaxAge = Math.max(1, Math.ceil((latestExpiry - now) / 1000));

  setResponseCookie(response,
    SKLAND_ACCOUNT_INDEX_COOKIE,
    sealSklandAccountIndex({
      version: 3,
      accountIds: store.accounts.map((account) => account.accountId),
      activeAccountId: store.activeAccountId,
      expiresAt: latestExpiry,
    }),
    cookieOptions(request, indexMaxAge)
  );
  for (const account of store.accounts) {
    const accountMaxAge = Math.max(1, Math.ceil((account.session.expiresAt - now) / 1000));
    setResponseCookie(response,
      sklandAccountCookieName(account.accountId),
      sealOwnedSklandAccount(account, store.websiteOwnerTag),
      cookieOptions(request, accountMaxAge)
    );
  }
}

export function withUpdatedSklandSession(
  store: SklandAccountStore,
  accountId: string,
  session: SklandSessionPayload
): SklandAccountStore {
  return {
    ...store,
    accounts: store.accounts.map((account) => account.accountId === accountId
      ? createSklandStoredAccount(session, account.roles, accountId)
      : account),
    activeAccountId: accountId,
    migratedSnapshot: null,
  };
}

export function assertSklandAvailable(request: Request): void {
  assertSklandFeatureEnabled();
  if (!isSklandConfigured()) throw new PublicApiError("AIC-AUTH-2003");
  if (!isSecureSklandRequest(request)) throw new PublicApiError("AIC-AUTH-2002");
}

export function assertSklandFeatureEnabled(): void {
  if (!isSklandFeatureEnabled()) throw new PublicApiError("AIC-AUTH-2007");
}

export function sklandErrorResponse(
  error: unknown,
  requestId: string,
  route: string,
  startedAt: number,
  request?: Request,
): Response {
  if (error instanceof PublicApiError) {
    return failureResponse(error, requestId, route, startedAt, "AIC-SYS-5000", request);
  }
  if (error instanceof SklandBindingConflictError) {
    return failureResponse(new PublicApiError("AIC-AUTH-2006"), requestId, route, startedAt, "AIC-SYS-5000", request);
  }
  if (error instanceof Error && error.message === "请求来源无效。") {
    return failureResponse(new PublicApiError("AIC-AUTH-2002"), requestId, route, startedAt, "AIC-SYS-5000", request);
  }
  if (error instanceof SklandServiceError) {
    const code = publicCodeForSklandServiceError(error.code);
    return failureResponse(new PublicApiError(code, { cause: error, message: error.message, retryAfter: error.retryAfterSeconds, retryable: error.retryable }), requestId, route, startedAt, "AIC-SYS-5000", request);
  }
  return failureResponse(new PublicApiError("AIC-SYS-5000", {cause:error}), requestId, route, startedAt, "AIC-SYS-5000", request);
}
