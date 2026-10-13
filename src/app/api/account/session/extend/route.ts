import { and, eq, gt } from "drizzle-orm";
import {
  assertEmptyBody,
  assertSameOrigin,
  createRequestId,
  enforceRateLimit,
  failureResponse,
  requestClientIp,
  PublicApiError,
  successResponse,
} from "@/server/api-contract";
import { requireWebsiteSession } from "@/server/auth/authorization";
import { extendedSessionCookie, extendedSessionExpiry } from "@/server/auth/session-lifetime";
import { getDatabase } from "@/server/db";
import { session } from "@/server/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSameOrigin(request);
    await assertEmptyBody(request, 1_024);
    const current = await requireWebsiteSession(request);
    enforceRateLimit("account-session-extend", requestClientIp(request), 5, 60 * 60_000);
    const expiresAt = extendedSessionExpiry();
    const [updated] = await getDatabase()
      .update(session)
      .set({ expiresAt, updatedAt: new Date() })
      .where(and(eq(session.id, current.session.id), eq(session.userId, current.user.id), gt(session.expiresAt, new Date())))
      .returning({ expiresAt: session.expiresAt });
    if (!updated) throw new PublicApiError("AIC-AUTH-2008");

    const response = successResponse({ expiresAt: updated.expiresAt.toISOString() }, requestId);
    const cookie = extendedSessionCookie(request);
    if (cookie) response.headers.append("Set-Cookie", cookie);
    return response;
  } catch (error) {
    return failureResponse(error, requestId, "/api/account/session/extend", startedAt, "AIC-SYS-5000", request);
  }
}
