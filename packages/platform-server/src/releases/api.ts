import "@tanstack/react-start/server-only";
import { appDeploymentEnvironment } from "@riic/arknights-domain/deployment";
import { parseReleaseDraft, parseReleaseMutation, RELEASE_LIMITS, ReleaseValidationError } from "@riic/arknights-domain/releases/validation";
import { requireWebsiteAdmin } from "../auth/authorization.ts";
import { assertSameOrigin, createRequestId, enforceRateLimit, failureResponse, PublicApiError, readJsonBody, requestClientIp, successResponse } from "../api-contract.ts";
import { createRelease, listAdminReleases, listPublishedReleases, mutateRelease, ReleaseConflictError, ReleaseNotFoundError } from "./service.ts";
import { cachePublicResponse, createPublicDataCache } from "../public-data-cache.ts";
import type { ReleaseApplication, ReleaseDraft } from "@riic/arknights-domain/releases/types";
import { endfieldWriteOriginAllowed } from "./origin.ts";

const publishedReleases = createPublicDataCache<string, ReleaseDraft[]>();

function assertReleaseOrigin(request: Request, application: ReleaseApplication) {
  if (application === "arknights") return assertSameOrigin(request);
  // The compatibility host's BETA_PUBLIC_ORIGIN belongs to Arknights. Endfield
  // must instead match the original browser origin preserved by its trusted proxy.
  if (!endfieldWriteOriginAllowed(request)) throw new PublicApiError("AIC-AUTH-2002");
}

function noStore(response: Response) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

async function respond(request: Request, action: (requestId: string) => Promise<Response>, isPublic = false) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    const response = await action(requestId);
    return isPublic ? cachePublicResponse(response) : noStore(response);
  }
  catch (error) {
    const normalized = error instanceof ReleaseValidationError ? new PublicApiError("AIC-REQ-1001", { message: error.message })
      : error instanceof ReleaseConflictError ? new PublicApiError("AIC-RELEASE-9001", { message: error.message })
      : error instanceof ReleaseNotFoundError ? new PublicApiError("AIC-RELEASE-9002", { message: error.message }) : error;
    return noStore(failureResponse(normalized, requestId, new URL(request.url).pathname, startedAt));
  }
}

export function handlePublicReleases(request: Request, application: ReleaseApplication = "arknights") {
  return respond(request, async (requestId) => {
    enforceRateLimit("release-notes-read", requestClientIp(request), 300, 10 * 60_000);
    const environment = appDeploymentEnvironment();
    const releases = await publishedReleases.get(`${application}:${environment}`, () => listPublishedReleases(environment, application));
    const announcement = new URL(request.url).searchParams.get("mode") === "announcement";
    return successResponse({ environment, releases: announcement ? releases.filter((release) => release.notify).slice(0, 1) : releases }, requestId);
  }, true);
}

export function handleAdminReleases(request: Request, application: ReleaseApplication = "arknights") {
  return respond(request, async (requestId) => {
    const admin = await requireWebsiteAdmin(request);
    const environment = appDeploymentEnvironment();
    enforceRateLimit("admin-release-notes", admin.session.user.id, 120, 10 * 60_000);
    if (request.method === "GET") {
      return successResponse({ environment, releases: await listAdminReleases(environment, application) }, requestId);
    }
    assertReleaseOrigin(request, application);
    const draft = parseReleaseDraft(await readJsonBody(request, RELEASE_LIMITS.bodyBytes));
    return successResponse({ release: await createRelease(environment, draft, admin.session.user.id, application) }, requestId, 201);
  });
}

export function handleAdminReleaseMutation(request: Request, id: string, application: ReleaseApplication = "arknights") {
  return respond(request, async (requestId) => {
    const admin = await requireWebsiteAdmin(request);
    assertReleaseOrigin(request, application);
    enforceRateLimit("admin-release-notes", admin.session.user.id, 120, 10 * 60_000);
    if (!/^[a-zA-Z0-9.-]{1,100}$/.test(id)) throw new ReleaseNotFoundError();
    const mutation = parseReleaseMutation(await readJsonBody(request, RELEASE_LIMITS.bodyBytes));
    const environment = appDeploymentEnvironment();
    const release = await mutateRelease(environment, id, mutation, admin.session.user.id, application);
    publishedReleases.invalidate(`${application}:${environment}`);
    return successResponse({ release }, requestId);
  });
}

/** Fixed application routes; callers cannot select the application or environment in input. */
export function handleEndfieldReleases(request: Request): Promise<Response> | Response {
  const path = new URL(request.url).pathname;
  if (path === "/api/endfield/admin/access" && request.method === "GET") {
    return respond(request, async (requestId) => {
      await requireWebsiteAdmin(request);
      return successResponse({ admin: true }, requestId);
    });
  }
  if (path === "/api/endfield/releases" && request.method === "GET") return handlePublicReleases(request, "endfield");
  if (path === "/api/endfield/admin/releases" && ["GET", "POST"].includes(request.method)) return handleAdminReleases(request, "endfield");
  const match = /^\/api\/endfield\/admin\/releases\/([a-zA-Z0-9.-]{1,100})$/.exec(path);
  if (match && request.method === "PATCH") return handleAdminReleaseMutation(request, match[1], "endfield");
  return new Response(null, { status: 405, headers: { "Cache-Control": "private, no-store" } });
}
