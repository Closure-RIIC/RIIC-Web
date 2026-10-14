import { createRequestId, failureResponse, healthHttpStatus, successResponse } from "@/server/api-contract";
import { probePublicHealth } from "@/server/public-health";


export async function GET() {
  const requestId = createRequestId();
  const startedAt = performance.now();
  let response: Response;
  try {
    const data = await probePublicHealth();
    response = successResponse(data, requestId, healthHttpStatus(data.plannerReady));
  } catch (error) {
    response = failureResponse(error, requestId, "/api/health", startedAt, "AIC-SYS-5000");
  }
  response.headers.set("Cache-Control", "no-store");
  return response;
}
