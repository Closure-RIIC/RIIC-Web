import { headers } from "next/headers";
import { websiteSession } from "@/server/auth";
import { assertSameOrigin, createRequestId, failureResponse, readJsonBody, successResponse } from "@/server/api-contract";
import { countUserWishes, createWish, listWishes } from "@/server/wishes";
import { getDonationSetting } from "@/server/site-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { return successResponse({ items: await listWishes("approved"), donation: await getDonationSetting() }, createRequestId()); }
  catch (error) { return failureResponse(error, createRequestId(), "/api/wishes", performance.now()); }
}

export async function POST(request: Request) {
  const startedAt = performance.now();
  try {
    assertSameOrigin(request);
    const session = await websiteSession(await headers());
    if (!session?.user.id) throw new Error("Authentication required");
    const body = await readJsonBody(request, 6 * 1024 * 1024) as { title?: unknown; content?: unknown; imageUrls?: unknown };
    if (typeof body?.title !== "string" || !body.title.trim() || body.title.length > 120 || typeof body.content !== "string" || !body.content.trim() || body.content.length > 5000) throw new Error("Invalid wish");
    if (await countUserWishes(session.user.id) >= 5) throw new Error("Wish limit reached");
    const imageUrls = Array.isArray(body.imageUrls) && body.imageUrls.every((value) => typeof value === "string" && /^data:image\/(png|jpeg|webp|gif);base64,/.test(value)) ? body.imageUrls : [];
    if (imageUrls.length > 4 || imageUrls.some((value) => value.length > 1_500_000) || imageUrls.reduce((total, value) => total + value.length, 0) > 4_000_000) throw new Error("Invalid images");
    return successResponse({ wish: await createWish({ userId: session.user.id, title: body.title.trim(), content: body.content.trim(), imageUrls }) }, createRequestId());
  } catch (error) { return failureResponse(error, createRequestId(), "/api/wishes", startedAt); }
}
