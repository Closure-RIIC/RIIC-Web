import "@tanstack/react-start/server-only";
import { appDeploymentEnvironment } from "../deployment.ts";
import { parseReleaseDraft, parseReleaseMutation, RELEASE_LIMITS, ReleaseValidationError } from "../releases/validation.ts";
import { requireWebsiteAdmin } from "./auth/authorization";
import { assertSameOrigin, createRequestId, enforceRateLimit, failureResponse, PublicApiError, readJsonBody, requestClientIp, successResponse } from "./api-contract";
import { createRelease, listAdminReleases, listPublishedReleases, mutateRelease, ReleaseConflictError, ReleaseNotFoundError } from "./release-notes.ts";
import { cachePublicResponse, createPublicDataCache } from "./public-data-cache.ts";
import type { ReleaseDraft, ReleaseEnvironment } from "../releases/types.ts";

const publishedReleases = createPublicDataCache<ReleaseEnvironment, ReleaseDraft[]>();

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

export function handlePublicReleases(request: Request) {
  return respond(request, async (requestId) => {
    enforceRateLimit("release-notes-read", requestClientIp(request), 300, 10 * 60_000);
    const environment = appDeploymentEnvironment();
    const releases = await publishedReleases.get(environment, () => listPublishedReleases(environment));
    const announcement = new URL(request.url).searchParams.get("mode") === "announcement";
    return successResponse({ environment, releases: announcement ? releases.filter((release) => release.notify).slice(0, 1) : releases }, requestId);
  }, true);
}

export function handleAdminReleases(request: Request) {
  return respond(request, async (requestId) => {
    const admin = await requireWebsiteAdmin(request);
    const environment = appDeploymentEnvironment();
    enforceRateLimit("admin-release-notes", admin.session.user.id, 120, 10 * 60_000);
    if (request.method === "GET") {
      return successResponse({ environment, releases: await listAdminReleases(environment) }, requestId);
    }
    assertSameOrigin(request);
    const draft = parseReleaseDraft(await readJsonBody(request, RELEASE_LIMITS.bodyBytes));
    return successResponse({ release: await createRelease(environment, draft, admin.session.user.id) }, requestId, 201);
  });
}

export function handleAdminReleaseMutation(request: Request, id: string) {
  return respond(request, async (requestId) => {
    const admin = await requireWebsiteAdmin(request);
    assertSameOrigin(request);
    enforceRateLimit("admin-release-notes", admin.session.user.id, 120, 10 * 60_000);
    if (!/^[a-zA-Z0-9.-]{1,100}$/.test(id)) throw new ReleaseNotFoundError();
    const mutation = parseReleaseMutation(await readJsonBody(request, RELEASE_LIMITS.bodyBytes));
    const environment = appDeploymentEnvironment();
    const release = await mutateRelease(environment, id, mutation, admin.session.user.id);
    publishedReleases.invalidate(environment);
    return successResponse({ release }, requestId);
  });
}
