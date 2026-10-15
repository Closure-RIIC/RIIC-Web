import { assertEmptyBody, assertSameOrigin, createRequestId, enforceRateLimit, requestClientIp, successResponse } from "@/server/api-contract";
import { requireWebsiteSession } from "@/server/auth/authorization";
import { SklandServiceError, syncSessionSnapshot } from "@/server/skland/adapter";
import { activeSklandAccount, assertSklandAvailable, assertSklandFeatureEnabled, readSklandAccountStore, sklandAccountSummaries, sklandErrorResponse } from "@/server/skland/http";


/** Background reads never write selection cookies: a late response must not undo a role switch. */
export async function POST(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSklandFeatureEnabled();
    const website = await requireWebsiteSession(request);
    assertSklandAvailable(request);
    assertSameOrigin(request);
    await assertEmptyBody(request, 1024);
    enforceRateLimit("skland-action", requestClientIp(request), 30, 60 * 60_000);
    const store = await readSklandAccountStore(website.user.id);
    const account = activeSklandAccount(store);
    if (!account) throw new SklandServiceError("AUTH_EXPIRED", "请先登录森空岛。", 401);
    const result = await syncSessionSnapshot(account.session);
    if (result.session.selectedUid !== account.session.selectedUid) {
      throw new SklandServiceError("BAD_DATA", "角色已变化，请重新选择森空岛角色。", 409);
    }
    const response = successResponse({
      authenticated: true, configured: true,
      accounts: sklandAccountSummaries(store), activeAccountId: store.activeAccountId,
      bindingCount: store.accounts.length,
      scheduleSnapshot: result.snapshot, statusSnapshot: result.statusSnapshot,
    }, requestId);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return sklandErrorResponse(error, requestId, "/api/skland/training-sync", startedAt, request);
  }
}
