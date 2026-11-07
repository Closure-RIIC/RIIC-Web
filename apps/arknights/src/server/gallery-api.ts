import "@tanstack/react-start/server-only";
import path from "node:path";
import { requireWebsiteAdmin, requireWebsiteSession } from "@riic/platform-server/auth/authorization";
import { assertSameOrigin, createRequestId, enforceRateLimit, failureResponse, PublicApiError, readJsonBody, requestClientIp, successResponse } from "@riic/platform-server/api-contract";
import { GalleryError, type GalleryActor, type GalleryStatus } from "../gallery-publishing.ts";
import { createGalleryService } from "./gallery-service.ts";

async function actorFor(request: Request): Promise<GalleryActor | null> {
  try {
    const session = await requireWebsiteSession(request);
    let role: GalleryActor["role"] = "user";
    try { await requireWebsiteAdmin(request); role = "admin"; }
    catch (error) { if (!(error instanceof PublicApiError) || error.code !== "AIC-AUTH-2009") throw error; }
    return { id: session.user.id, name: session.user.name, role };
  } catch (error) {
    if (error instanceof PublicApiError && error.code === "AIC-AUTH-2008") return null;
    throw error;
  }
}
function serviceFor() {
  const configured = process.env.SCHEDULE_GALLERY_STORAGE_DIR?.trim();
  if (configured && !path.isAbsolute(configured)) throw new Error("Gallery storage must be absolute");
  if (!configured && process.env.NODE_ENV === "production") throw new Error("Gallery storage is not configured");
  return createGalleryService(configured ?? path.join(process.cwd(), ".tmp", "schedule-gallery"));
}
function noStore(response: Response) { response.headers.set("Cache-Control", "private, no-store"); return response; }
export async function handleGallery(request: Request, adminMode = false) {
  const requestId = createRequestId(); const started = performance.now();
  try {
    enforceRateLimit(`schedule-gallery-${request.method}`, requestClientIp(request), request.method === "GET" ? 180 : 40, 60_000);
    const actor = await actorFor(request);
    if (adminMode && actor?.role !== "admin") throw new GalleryError("forbidden");
    const service = serviceFor();
    const listingActor = !adminMode && actor?.role === "admin" ? { ...actor, role: "user" as const } : actor;
    if (request.method === "GET") return noStore(successResponse({ entries: await service.list(listingActor), actor: actor ? { name: actor.name, role: actor.role } : null }, requestId));
    assertSameOrigin(request);
    const body = await readJsonBody(request, 512 * 1024) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") throw new GalleryError("invalid");
    if (body.action === "submit") {
      if (body.publish === true && !adminMode) throw new GalleryError("forbidden");
      if (body.id !== undefined && (typeof body.id !== "string" || !Number.isInteger(body.revision))) throw new GalleryError("invalid");
      const entry = await service.submit(actor, body.submission, { id: body.id as string | undefined, revision: body.revision as number | undefined, publish: body.publish === true });
      return noStore(successResponse({ entry }, requestId));
    }
    if (body.action === "review" && typeof body.id === "string" && Number.isInteger(body.revision) && typeof body.note === "string") {
      if (!adminMode) throw new GalleryError("forbidden");
      const entry = await service.review(actor, body.id, body.revision as number, body.decision as GalleryStatus, body.note);
      return noStore(successResponse({ entry }, requestId));
    }
    throw new GalleryError("invalid");
  } catch (error) {
    if (error instanceof GalleryError) return noStore(Response.json({ success: false, galleryError: error.code }, { status: error.code === "forbidden" ? 403 : error.code === "notFound" ? 404 : error.code === "conflict" ? 409 : 400 }));
    return noStore(failureResponse(error, requestId, adminMode ? "/api/admin/schedule-gallery" : "/api/schedule-gallery", started));
  }
}
