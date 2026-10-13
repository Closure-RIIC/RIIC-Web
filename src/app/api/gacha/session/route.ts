import { assertSameOrigin, createRequestId, failureResponse, successResponse } from "@/server/api-contract";
import { requireWebsiteSession } from "@/server/auth/authorization";
import { gachaCookieName, gachaSession, publicGachaRoles, revokeGachaSession } from "@/server/gacha-history";
import { assertSklandFeatureEnabled, readSklandAccountStore, sklandAccountSummaries } from "@/server/skland/http";
import { listGachaArchives } from "@/server/gacha-archive";
import { gachaAccountOptions } from "@/gacha-accounts";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSklandFeatureEnabled();
    const user = await requireWebsiteSession(request);
    const session = gachaSession(request, user.user.id);
    const [archives, store] = await Promise.all([listGachaArchives(user.user.id), readSklandAccountStore(user.user.id)]);
    const response = successResponse(gachaAccountOptions(sklandAccountSummaries(store), archives, session ? publicGachaRoles(session) : []), requestId);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) { return failureResponse(error, requestId, "/api/gacha/session", startedAt, "AIC-SYS-5000", request); }
}

export async function DELETE(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSklandFeatureEnabled();
    assertSameOrigin(request);
    await requireWebsiteSession(request);
    revokeGachaSession(request);
    const response = successResponse({ disconnected: true }, requestId);
    response.cookies.set(gachaCookieName(), "", { httpOnly: true, sameSite: "lax", path: "/api/gacha", maxAge: 0 });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) { return failureResponse(error, requestId, "/api/gacha/session", startedAt, "AIC-SYS-5000", request); }
}
