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
import { loadInventorySnapshot, SklandServiceError } from "./adapter";
import {
  activeSklandAccount,
  assertSklandAvailable,
  assertSklandFeatureEnabled,
  readSklandAccountStore,
  sklandErrorResponse,
} from "./http";

export async function handleGetSklandInventory(request: Request, route: string) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSklandFeatureEnabled();
    const website = await requireWebsiteSession(request);
    assertSklandAvailable(request);
    assertSameOrigin(request);
    await assertEmptyBody(request, 1024);
    enforceRateLimit("skland-action", requestClientIp(request), 30, 60 * 60_000);

    const previous = await readSklandAccountStore(website.user.id);
    const account = activeSklandAccount(previous);
    if (!account) throw new SklandServiceError("AUTH_EXPIRED", "请先登录森空岛。", 401);

    const loaded = await loadInventorySnapshot(account.session);
    const response = successResponse({
      ...loaded.inventory,
      identityKey: JSON.stringify([website.user.id, account.accountId, loaded.session.selectedUid]),
    }, requestId);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return sklandErrorResponse(error, requestId, route, startedAt, request);
  }
}
