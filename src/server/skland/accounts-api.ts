import "@tanstack/react-start/server-only";

import {
  assertEmptyBody,
  assertSameOrigin,
  createRequestId,
  enforceRateLimit,
  PublicApiError,
  readJsonBody,
  requestClientIp,
  successResponse,
} from "../api-contract";
import { requireWebsiteSession } from "../auth/authorization";
import { getSklandBindingSummary, removeSklandBindings } from "./bindings";
import {
  activeSklandAccount,
  assertSklandAvailable,
  assertSklandFeatureEnabled,
  loadActiveSklandAccount,
  readSklandAccountStore,
  setSklandAccountStoreCookies,
  sklandAccountSummaries,
  sklandErrorResponse,
} from "./http";
import { removeSklandAccount } from "./session";
import { isSecureSklandRequest, isSklandConfigured } from "./session";
import { resolveSklandSessionView, sklandSessionMode } from "./session-view";
import type { SklandBindingSummary } from "../../types";

const authMethods = { qr: true as const, credential: true as const };

function deprecated(response: Response, successor: string): Response {
  response.headers.set("Deprecation", "true");
  response.headers.set("Link", `<${successor}>; rel="successor-version"`);
  return response;
}

export async function handleGetSklandAccounts(request: Request, route: string) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  let websiteUserId: string;
  let bindingSummary: SklandBindingSummary;
  let mode: ReturnType<typeof sklandSessionMode>;
  try {
    assertSklandFeatureEnabled();
    mode = sklandSessionMode(request.url);
    websiteUserId = (await requireWebsiteSession(request)).user.id;
  } catch (error) {
    return sklandErrorResponse(error, requestId, route, startedAt, request);
  }
  const bindingSummaryPromise = getSklandBindingSummary(websiteUserId);
  if (!isSklandConfigured() || !isSecureSklandRequest(request)) {
    try {
      bindingSummary = await bindingSummaryPromise;
    } catch (error) {
      return sklandErrorResponse(error, requestId, route, startedAt, request);
    }
    return successResponse({
      authenticated: false,
      configured: isSklandConfigured(),
      authMethods,
      disabledReason: "当前未开放森空岛登录，可使用 MAA 导入。",
      accounts: [],
      activeAccountId: null,
      bindingCount: bindingSummary.totalCount,
      bindingSummary,
    }, requestId);
  }
  try {
    const [previous, resolvedBindingSummary] = await Promise.all([
      readSklandAccountStore(websiteUserId),
      bindingSummaryPromise,
    ]);
    bindingSummary = resolvedBindingSummary;
    const resolved = await resolveSklandSessionView({
      mode,
      store: previous,
      bindingSummary,
      accountSummaries: sklandAccountSummaries,
      activeAccountId: (store) => activeSklandAccount(store)?.accountId ?? null,
      loadFull: loadActiveSklandAccount,
    });
    const response = successResponse(resolved.data, requestId);
    if (resolved.refreshed) setSklandAccountStoreCookies(response, request, resolved.store, previous);
    return response;
  } catch (error) {
    return sklandErrorResponse(error, requestId, route, startedAt, request);
  }
}

async function deleteSklandAccounts(
  request: Request,
  accountId: string | null,
  route: string,
  requireEmptyBody = false,
) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSklandFeatureEnabled();
    const website = await requireWebsiteSession(request);
    assertSklandAvailable(request);
    assertSameOrigin(request);
    if (requireEmptyBody) await assertEmptyBody(request, 1024);
    enforceRateLimit("skland-action", requestClientIp(request), 30, 60 * 60_000);
    const previous = await readSklandAccountStore(website.user.id);
    let next = previous;
    let removedSklandUserIds: string[];
    if (accountId) {
      if (!previous.accounts.some((account) => account.accountId === accountId)) {
        throw new PublicApiError("AIC-REQ-1001");
      }
      removedSklandUserIds = previous.accounts
        .filter((account) => account.accountId === accountId)
        .map((account) => account.session.userId);
      const removed = removeSklandAccount(previous.accounts, previous.activeAccountId, accountId);
      next = { ...previous, ...removed, migratedSnapshot: null };
    } else {
      removedSklandUserIds = previous.accounts.map((account) => account.session.userId);
      next = { ...previous, accounts: [], activeAccountId: null, migratedSnapshot: null };
    }
    await removeSklandBindings(website.user.id, removedSklandUserIds);
    const loaded = await loadActiveSklandAccount(next);
    const bindingSummary = await getSklandBindingSummary(website.user.id);
    const response = successResponse({
      authenticated: Boolean(loaded.snapshot),
      configured: true,
      authMethods,
      accounts: sklandAccountSummaries(loaded.store),
      activeAccountId: loaded.store.activeAccountId,
      bindingCount: bindingSummary.totalCount,
      bindingSummary,
      ...(loaded.snapshot ? { scheduleSnapshot: loaded.snapshot } : {}),
      ...(loaded.statusSnapshot ? { statusSnapshot: loaded.statusSnapshot } : {}),
    }, requestId);
    setSklandAccountStoreCookies(response, request, loaded.store, previous);
    return response;
  } catch (error) {
    return sklandErrorResponse(error, requestId, route, startedAt, request);
  }
}

export async function handleDeleteAllSklandAccounts(request: Request, route: string) {
  return deleteSklandAccounts(request, null, route, true);
}

export async function handleDeleteSklandAccount(request: Request, accountId: string, route: string) {
  return deleteSklandAccounts(request, accountId.trim(), route, true);
}

export async function handleLegacyGetSklandSession(request: Request) {
  return deprecated(await handleGetSklandAccounts(request, "/api/skland/session"), "/api/skland/accounts");
}

export async function handleLegacyDeleteSklandSession(request: Request) {
  let accountId: string | null = null;
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  const hasDeclaredBody = contentLength > 0
    || request.headers.has("transfer-encoding")
    || request.headers.has("content-type");
  if (hasDeclaredBody) {
    try {
      const body = await readJsonBody(request, 16 * 1024) as { accountId?: unknown } | null;
      if (typeof body?.accountId !== "string" || !body.accountId.trim()) throw new PublicApiError("AIC-REQ-1001");
      accountId = body.accountId.trim();
    } catch (error) {
      return deprecated(
        sklandErrorResponse(error, createRequestId(), "/api/skland/session", performance.now()),
        "/api/skland/accounts",
      );
    }
  }
  const successor = accountId
    ? `/api/skland/accounts/${encodeURIComponent(accountId)}`
    : "/api/skland/accounts";
  return deprecated(
    await deleteSklandAccounts(request, accountId, "/api/skland/session"),
    successor,
  );
}
