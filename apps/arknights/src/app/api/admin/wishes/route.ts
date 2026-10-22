import { requireWebsiteReviewer } from "@riic/platform-server/auth/authorization";
import { assertSameOrigin, createRequestId, failureResponse, PublicApiError, readJsonBody, successResponse } from "@riic/platform-server/api-contract";
import { listWishes, updateWish, type WishStatus } from "@/server/wishes";


export async function GET(request: Request) {
  const startedAt = performance.now();
  try { await requireWebsiteReviewer(request); return successResponse({ items: await listWishes() }, createRequestId()); }
  catch (error) { return failureResponse(error, createRequestId(), "/api/admin/wishes", startedAt); }
}

export async function PATCH(request: Request) {
  const startedAt = performance.now();
  try {
    assertSameOrigin(request);
    await requireWebsiteReviewer(request);
    const body = await readJsonBody(request, 8 * 1024) as { id?: unknown; status?: unknown; adminNote?: unknown };
    if (!body || typeof body.id !== "string" || !body.id || body.id.length > 128 || !["pending", "approved", "rejected", "hidden"].includes(String(body.status))) throw new PublicApiError("AIC-REQ-1001");
    return successResponse({ wish: await updateWish(body.id, { status: body.status as WishStatus, adminNote: typeof body.adminNote === "string" ? body.adminNote.slice(0, 2000) : undefined }) }, createRequestId());
  } catch (error) { return failureResponse(error, createRequestId(), "/api/admin/wishes", startedAt); }
}
