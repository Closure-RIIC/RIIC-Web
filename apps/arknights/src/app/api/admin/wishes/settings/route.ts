import { requireWebsiteAdmin } from "@riic/platform-server/auth/authorization";
import { assertSameOrigin, createRequestId, failureResponse, readJsonBody, successResponse } from "@riic/platform-server/api-contract";
import { getDonationSetting, saveDonationSetting } from "@/server/site-settings";


export async function GET(request: Request) {
  const startedAt = performance.now();
  try { await requireWebsiteAdmin(request); return successResponse({ donation: await getDonationSetting() }, createRequestId()); }
  catch (error) { return failureResponse(error, createRequestId(), "/api/admin/wishes/settings", startedAt); }
}

export async function PUT(request: Request) {
  const startedAt = performance.now();
  try {
    assertSameOrigin(request); await requireWebsiteAdmin(request);
    const body = await readJsonBody(request, 2 * 1024 * 1024) as { enabled?: unknown; imageUrl?: unknown };
    const imageUrl = typeof body.imageUrl === "string" && /^data:image\/(png|jpeg|webp|gif);base64,/.test(body.imageUrl) && body.imageUrl.length <= 1_500_000 ? body.imageUrl : null;
    return successResponse({ donation: await saveDonationSetting({ enabled: body.enabled === true && Boolean(imageUrl), imageUrl }) }, createRequestId());
  } catch (error) { return failureResponse(error, createRequestId(), "/api/admin/wishes/settings", startedAt); }
}
