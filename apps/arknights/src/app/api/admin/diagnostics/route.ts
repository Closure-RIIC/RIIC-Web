import { createRequestId, enforceRateLimit, failureResponse, PublicApiError, successResponse } from "@riic/platform-server/api-contract";
import { requireWebsiteReviewer } from "@riic/platform-server/auth/authorization";
import { readDiagnostics } from "@riic/platform-server/request-diagnostics";


export async function GET(request: Request) {
  const requestId=createRequestId();
  const startedAt=performance.now();
  try {
    const admin=await requireWebsiteReviewer(request);
    enforceRateLimit("admin-diagnostics",admin.session.user.id,12,60_000);
    const hours=new URL(request.url).searchParams.get("hours") ?? "1";
    if (hours!=="1" && hours!=="24") throw new PublicApiError("AIC-REQ-1001");
    const response=successResponse(await readDiagnostics(hours==="24" ? 24 : 1),requestId);
    response.headers.set("Cache-Control","private, no-store");
    return response;
  } catch(error) {
    const response=failureResponse(error,requestId,"/api/admin/diagnostics",startedAt,"AIC-SYS-5000",request);
    response.headers.set("Cache-Control","private, no-store");
    return response;
  }
}
