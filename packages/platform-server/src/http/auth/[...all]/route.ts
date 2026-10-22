import { eq } from "drizzle-orm";
import { getAuth, websiteSession } from "../../../auth";
import { getDatabase } from "../../../db";
import { user } from "../../../db/schema";
import { assertSameOrigin, enforceRateLimit, PublicApiError, readJsonBody, requestClientIp } from "../../../api-contract";
import { isForbiddenNativeAdminPath } from "../../../auth/native-route-policy";
import { responseWithClearedSklandCookies, responseWithLegacyAuthCookieCleanup } from "../../../auth/session-cookie-cleanup";
import { evictPlanCacheKeys, userPlanCacheKeys } from "../../../plan-cache";
import { localTestAuthResponse } from "../../../auth/local-test-account";


async function handle(request: Request) {
  const localResponse = await localTestAuthResponse(request);
  if (localResponse) return localResponse;
  if (isForbiddenNativeAdminPath(request.url)) {
    return Response.json({ code: "NOT_FOUND", message: "Not found" }, { status: 404 });
  }
  const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
  if (request.method === "POST" && pathname === "/api/auth/request-password-reset") {
    try {
    assertSameOrigin(request);
    enforceRateLimit("password-reset-lookup", requestClientIp(request), 5, 60_000);
    const body = await readJsonBody(request.clone(), 8 * 1024) as { email?: unknown } | null;
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const [account] = email
      ? await getDatabase().select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1)
      : [];
    if (!account) return Response.json({ code: "USER_NOT_FOUND", message: "User is not registered." }, { status: 404 });
    } catch (error) {
      const status = error instanceof PublicApiError ? error.status : 500;
      return Response.json({ code: error instanceof PublicApiError ? error.code : "INTERNAL_SERVER_ERROR", message: error instanceof PublicApiError ? error.message : "Unable to request password reset." }, { status });
    }
  }
  if (pathname === "/api/auth/delete-user") {
    const current = await websiteSession(request);
    if (current?.user.id) await evictPlanCacheKeys(await userPlanCacheKeys(current.user.id));
  }
  const response = responseWithLegacyAuthCookieCleanup(await getAuth().handler(request), request);
  if (response.ok && ["/api/auth/sign-out", "/api/auth/delete-user", "/api/auth/revoke-sessions"].includes(pathname)) {
    return responseWithClearedSklandCookies(response, request);
  }
  return response;
}

export const GET = handle;
export const POST = handle;
