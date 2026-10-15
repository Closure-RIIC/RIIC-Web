import { requireWebsiteSession } from "@/server/auth/authorization";
import { assertSameOrigin, createRequestId, enforceRateLimit, failureResponse, PublicApiError, readJsonBody, requestClientIp, successResponse } from "@/server/api-contract";
import { createWish, listPublicWishes } from "@/server/wishes";
import { getDonationSetting } from "@/server/site-settings";
import { parseWishInput } from "@/wish-validation";


export async function GET() {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    const donation = await getDonationSetting();
    return successResponse({ items: await listPublicWishes(), donation: donation.enabled ? donation : { enabled: false, imageUrl: null } }, requestId);
  } catch (error) { return failureResponse(error, requestId, "/api/wishes", startedAt); }
}

export async function POST(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSameOrigin(request);
    const session = await requireWebsiteSession(request);
    enforceRateLimit("wish-submit", requestClientIp(request), 10, 60_000);
    const input = parseWishInput(await readJsonBody(request, 6 * 1024 * 1024));
    if (!input) throw new PublicApiError("AIC-REQ-1001");
    return successResponse({ wish: await createWish({ userId: session.user.id, ...input }) }, requestId);
  } catch (error) { return failureResponse(error, requestId, "/api/wishes", startedAt); }
}
