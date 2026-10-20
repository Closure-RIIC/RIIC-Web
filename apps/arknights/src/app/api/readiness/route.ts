import { createRequestId, failureResponse, healthHttpStatus, successResponse } from "@/server/api-contract";
import { probePublicHealth } from "@/server/public-health";
import { createReadinessCache } from "@/server/readiness-cache";


const readReadiness = createReadinessCache(probePublicHealth, () =>
  `${process.env.APP_RELEASE_SHA ?? ""}:${process.env.APP_BUILD_ID ?? ""}`,
);

export async function GET() {
  const requestId = createRequestId();
  const startedAt = performance.now();
  let response: Response;
  try {
    const data = await readReadiness();
    response = successResponse(data, requestId, healthHttpStatus(data.plannerReady));
  } catch (error) {
    response = failureResponse(error, requestId, "/api/readiness", startedAt, "AIC-SYS-5000");
  }
  response.headers.set("Cache-Control", "no-store");
  return response;
}
