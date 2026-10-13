import { eq } from "drizzle-orm";
import { getAuth, websiteSession } from "@/server/auth";
import { getDatabase } from "@/server/db";
import { user } from "@/server/db/schema";
import { assertSameOrigin, enforceRateLimit, PublicApiError, readJsonBody, requestClientIp } from "@/server/api-contract";
import { isForbiddenNativeAdminPath } from "@/server/auth/native-route-policy";
import { responseWithClearedSklandCookies } from "@/server/auth/session-cookie-cleanup";
import { evictPlanCacheKeys, userPlanCacheKeys } from "@/server/plan-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request) {
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
  const response = await getAuth().handler(request);
  if (response.ok && ["/api/auth/sign-out", "/api/auth/delete-user", "/api/auth/revoke-sessions"].includes(pathname)) {
    return responseWithClearedSklandCookies(response, request);
  }
  return response;
}

export const GET = handle;
export const POST = handle;
