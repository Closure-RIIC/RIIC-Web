import { headers } from "next/headers";
import { requireWebsiteReviewer } from "@/server/auth/authorization";
import { assertSameOrigin, createRequestId, failureResponse, readJsonBody, successResponse } from "@/server/api-contract";
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
    if (typeof body.id !== "string" || !["pending", "approved", "rejected", "hidden"].includes(String(body.status))) throw new Error("Invalid wish review");
    return successResponse({ wish: await updateWish(body.id, { status: body.status as WishStatus, adminNote: typeof body.adminNote === "string" ? body.adminNote : undefined }) }, createRequestId());
  } catch (error) { return failureResponse(error, createRequestId(), "/api/admin/wishes", startedAt); }
}
