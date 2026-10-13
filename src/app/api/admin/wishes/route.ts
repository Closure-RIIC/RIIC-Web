import { headers } from "next/headers";
import { requireWebsiteReviewer } from "@/server/auth/authorization";
import { assertSameOrigin, createRequestId, failureResponse, PublicApiError, readJsonBody, successResponse } from "@/server/api-contract";
import { listWishes, updateWish, type WishStatus } from "@/server/wishes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = performance.now();
  try { await requireWebsiteReviewer(await headers()); return successResponse({ items: await listWishes() }, createRequestId()); }
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
