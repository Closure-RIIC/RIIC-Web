import "@tanstack/react-start/server-only";

import { assertEmptyBody, assertSameOrigin, createRequestId, enforceRateLimit, failureResponse, PublicApiError, readJsonBody, requestClientIp, successResponse } from "@riic/platform-server/api-contract";
import { requireWebsiteSession } from "@riic/platform-server/auth/authorization";
import { parseGameReportDays } from "@riic/arknights-domain/game-report";
import { latestGameReport, saveGameReport } from "./game-report-store";

const ROUTE = "/api/account/game-report";

export async function handleGetGameReport(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    const session = await requireWebsiteSession(request);
    await assertEmptyBody(request, 1024);
    return successResponse(await latestGameReport(session.user.id), requestId);
  } catch (error) { return failureResponse(error, requestId, ROUTE, startedAt); }
}

export async function handlePostGameReport(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    const session = await requireWebsiteSession(request);
    assertSameOrigin(request);
    enforceRateLimit("game-report-write", requestClientIp(request), 12, 60 * 60_000);
    const body = await readJsonBody(request, 4 * 1024) as { sourceType?: unknown; days?: unknown } | null;
    const days = parseGameReportDays(body?.days, false, true);
    if (!days || (body?.sourceType !== "screenshot" && body?.sourceType !== "manual")) throw new PublicApiError("AIC-REQ-1001");
    return successResponse(await saveGameReport(session.user.id, body.sourceType, days), requestId);
  } catch (error) { return failureResponse(error, requestId, ROUTE, startedAt); }
}
