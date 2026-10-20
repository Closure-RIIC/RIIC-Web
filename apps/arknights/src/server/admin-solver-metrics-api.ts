import "@tanstack/react-start/server-only";

import type { AdminSolverMetricsData } from "@/types";
import {
  createRequestId,
  failureResponse,
  PublicApiError,
  successResponse,
} from "./api-contract";
import { requireWebsiteReviewer } from "./auth/authorization";
import { isBusinessDatabaseReadEnabled } from "./business-config";
import { queryAdminSolverMetrics } from "./business-records";

const ROUTE = "/api/admin/solver-metrics";

function noStore(response: Response): Response {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

export async function handleGetAdminSolverMetrics(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    await requireWebsiteReviewer(request);
    if (!isBusinessDatabaseReadEnabled()) throw new PublicApiError("AIC-DATA-8002");
    return noStore(successResponse<AdminSolverMetricsData>(await queryAdminSolverMetrics(), requestId));
  } catch (error) {
    return noStore(failureResponse(error, requestId, ROUTE, startedAt));
  }
}
