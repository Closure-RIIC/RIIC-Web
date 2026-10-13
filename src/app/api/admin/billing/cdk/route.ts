import { assertSameOrigin, createRequestId, enforceRateLimit, failureResponse, PublicApiError, readJsonBody, successResponse } from "@/server/api-contract";
import { requireWebsiteAdmin } from "@/server/auth/authorization";
import { issueAdminCdks, listAdminCdks, revokeAdminCdks } from "@/server/billing/admin-cdk";
import { CdkValidationError } from "@/server/billing/cdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  let response: Response;
  try {
    const { session } = await requireWebsiteAdmin(request);
    if (request.method === "GET") {
      response = successResponse(await listAdminCdks(new URL(request.url).searchParams), requestId);
    } else {
      assertSameOrigin(request);
      enforceRateLimit("admin-cdk-issue", session.user.id, 20, 60_000);
      const body = await readJsonBody(request, 16 * 1024);
      response = request.method === "PATCH"
        ? successResponse(await revokeAdminCdks(session.user.id, body), requestId)
        : successResponse(await issueAdminCdks(session.user.id, body), requestId, 201);
    }
  } catch (error) {
    response = failureResponse(error instanceof CdkValidationError
      ? new PublicApiError("AIC-REQ-1001", { message: error.message }) : error,
    requestId, "/api/admin/billing/cdk", startedAt, "AIC-SYS-5000", request);
  }
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
