import { assertEmptyBody, assertSameOrigin, createRequestId, enforceRateLimit, successResponse } from "@/server/api-contract";
import { requireWebsiteSession } from "@/server/auth/authorization";
import { sklandAttendance, SklandServiceError } from "@/server/skland/adapter";
import { assertSklandAvailable, assertSklandFeatureEnabled, readSklandAccountStore, setSklandAccountStoreCookies, sklandErrorResponse, withUpdatedSklandSession } from "@/server/skland/http";

async function handle(request: Request, sign: boolean) {
  const requestId = createRequestId(), startedAt = performance.now();
  try {
    assertSklandFeatureEnabled();
    const website = await requireWebsiteSession(request);
    assertSklandAvailable(request);
    if (sign) { assertSameOrigin(request); await assertEmptyBody(request, 1024); }
    enforceRateLimit(sign ? "skland-attendance-write" : "skland-attendance-read", website.user.id, sign ? 30 : 120, 60_000);
    const url = new URL(request.url), accountId = url.searchParams.get("accountId"), uid = url.searchParams.get("uid");
    const previous = await readSklandAccountStore();
    const account = previous.accounts.find(a => a.accountId === accountId);
    if (!account) throw new SklandServiceError("AUTH_EXPIRED", "请先登录森空岛。", 401);
    if (!uid || uid.length > 64 || !account.roles.some(r => r.uid === uid)) throw new SklandServiceError("BAD_DATA", "当前账号未绑定该角色。", 403);
    const loaded = await sklandAttendance(account.session, uid, sign);
    const response = successResponse(loaded.attendance, requestId);
    response.headers.set("Cache-Control", "private, no-store");
    if (loaded.session.token !== account.session.token) setSklandAccountStoreCookies(response, request, withUpdatedSklandSession(previous, account.accountId, loaded.session), previous);
    return response;
  } catch (error) { return sklandErrorResponse(error, requestId, "/api/skland/attendance", startedAt, request); }
}
export const GET = (request: Request) => handle(request, false);
export const POST = (request: Request) => handle(request, true);
