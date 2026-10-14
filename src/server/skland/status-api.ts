import "@tanstack/react-start/server-only";

import {
  assertEmptyBody,
  assertSameOrigin,
  createRequestId,
  enforceRateLimit,
  requestClientIp,
  successResponse,
} from "../api-contract";
import { requireWebsiteSession } from "../auth/authorization";
import { loadStatusSnapshot, SklandServiceError } from "./adapter";
import {
  activeSklandAccount,
  assertSklandAvailable,
  assertSklandFeatureEnabled,
  readSklandAccountStore,
  setSklandAccountStoreCookies,
  sklandAccountSummaries,
  sklandErrorResponse,
  withUpdatedSklandSession,
} from "./http";

export async function handleRefreshSklandStatus(request: Request, route: string) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSklandFeatureEnabled();
    await requireWebsiteSession(request);
    assertSklandAvailable(request);
    assertSameOrigin(request);
    await assertEmptyBody(request, 1024);
    enforceRateLimit("skland-action", requestClientIp(request), 30, 60 * 60_000);
    const previous = await readSklandAccountStore();
    const account = activeSklandAccount(previous);
    if (!account) throw new SklandServiceError("AUTH_EXPIRED", "请先登录森空岛。", 401);
    const loaded = await loadStatusSnapshot(account.session);
    const next = withUpdatedSklandSession(previous, account.accountId, loaded.session);
    const response = successResponse({
      accounts: sklandAccountSummaries(next),
      activeAccountId: next.activeAccountId,
      snapshot: loaded.snapshot,
    }, requestId);
    setSklandAccountStoreCookies(response, request, next, previous);
    return response;
  } catch (error) {
    return sklandErrorResponse(error, requestId, route, startedAt, request);
  }
}

export async function handleLegacyGetSklandStatus(request: Request) {
  const response = await handleRefreshSklandStatus(request, "/api/skland/status");
  response.headers.set("Deprecation", "true");
  response.headers.set("Link", "</api/skland/status/refresh>; rel=\"successor-version\"");
  return response;
}
