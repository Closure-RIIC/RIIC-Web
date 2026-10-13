import { assertSameOrigin, createRequestId, enforceRateLimit, failureResponse, PublicApiError, readJsonBody, requestClientIp, successResponse } from "@/server/api-contract";
import { requireWebsiteSession } from "@/server/auth/authorization";
import { authorizeGachaFromSkland, gachaCookieName, gachaSession, publicGachaError, publicGachaRoles } from "@/server/gacha-history";
import { activeSklandAccount, assertSklandFeatureEnabled, readSklandAccountStore } from "@/server/skland/http";
import { isCurrentPolicyConsent } from "@/legal-policy";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSklandFeatureEnabled();
    assertSameOrigin(request);
    const website = await requireWebsiteSession(request);
    enforceRateLimit("gacha-skland", `${website.user.id}:${requestClientIp(request)}`, 6, 10 * 60_000);
    const body = await readJsonBody(request, 2048) as { consent?: unknown; gachaConsent?: unknown; accountId?: unknown; uid?: unknown } | null;
    if (!isCurrentPolicyConsent(body?.consent) || body?.gachaConsent !== true) throw new PublicApiError("AIC-AUTH-2005");
    const store = await readSklandAccountStore(website.user.id);
    const account = typeof body?.accountId === "string"
      ? store.accounts.find((entry) => entry.accountId === body.accountId) : activeSklandAccount(store);
    if (!account) throw new PublicApiError("AIC-AUTH-2008", { message: "本站尚无可用的森空岛登录状态，请先登录森空岛，或直接在此弹窗扫码。" });
    const selectedUid = typeof body?.uid === "string" ? body.uid : account.session.selectedUid;
    if (selectedUid !== account.session.selectedUid && !account.roles.some((role) => role.uid === selectedUid)) throw new PublicApiError("AIC-REQ-1001", { message: "当前森空岛登录未包含所选角色，请使用对应账号扫码授权。" });
    const existing = gachaSession(request, website.user.id);
    const result = existing?.roles.some((role) => role.uid === selectedUid)
      ? { roles: publicGachaRoles(existing), selectedUid, sessionId: null }
      : await authorizeGachaFromSkland(website.user.id, { ...account.session, selectedUid });
    const response = successResponse({ roles: result.roles, selectedUid: result.selectedUid }, requestId);
    if (result.sessionId) response.cookies.set(gachaCookieName(), result.sessionId, {
      httpOnly: true, sameSite: "lax", secure: new URL(request.url).protocol === "https:", path: "/api/gacha", maxAge: 60 * 60,
    });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return failureResponse(publicGachaError(error), requestId, "/api/gacha/skland", startedAt, "AIC-SYS-5000", request);
  }
}
