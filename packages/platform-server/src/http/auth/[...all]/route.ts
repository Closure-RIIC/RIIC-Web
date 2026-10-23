import { getAuth, websiteSession } from "../../../auth";
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
      await readJsonBody(request.clone(), 8 * 1024);
      // Better Auth validates redirects and gives the same response for registered
      // and unknown emails. Never expose account existence before that boundary.
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

async function privateAuthResponse(request: Request) {
  const response = await handle(request);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const GET = privateAuthResponse;
export const POST = privateAuthResponse;
