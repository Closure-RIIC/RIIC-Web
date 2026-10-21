import "@tanstack/react-start/server-only";

import {
  assertEmptyBody,
  assertSameOrigin,
  createRequestId,
  enforceRateLimit,
  failureResponse,
  readJsonBody,
  requestClientIp,
  successResponse,
} from "./api-contract";
import { requireWebsiteSession } from "./auth/authorization";
import { deleteSavedPlan, listSavedPlans, updateSavedPlan } from "./workspace";

export type SavedPlanRoute =
  | "/api/account/saved-plans"
  | "/api/account/saved-plans/[id]"
  | "/api/plans"
  | "/api/plans/[id]";

export async function handleListSavedPlans(request: Request, route: SavedPlanRoute) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    const session = await requireWebsiteSession(request);
    return successResponse(await listSavedPlans(session.user.id), requestId);
  } catch (error) {
    return failureResponse(error, requestId, route, startedAt);
  }
}

export async function handleUpdateSavedPlan(
  request: Request,
  context: { params: Promise<{ id: string }> },
  route: SavedPlanRoute,
) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSameOrigin(request);
    enforceRateLimit("saved-plan-write", requestClientIp(request), 20, 10 * 60_000);
    const session = await requireWebsiteSession(request);
    const { id } = await context.params;
    return successResponse(await updateSavedPlan(session.user.id, id, await readJsonBody(request, 16 * 1024)), requestId);
  } catch (error) {
    return failureResponse(error, requestId, route, startedAt);
  }
}

export async function handleDeleteSavedPlan(
  request: Request,
  context: { params: Promise<{ id: string }> },
  route: SavedPlanRoute,
) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSameOrigin(request);
    enforceRateLimit("saved-plan-delete", requestClientIp(request), 10, 10 * 60_000);
    await assertEmptyBody(request, 1024);
    const session = await requireWebsiteSession(request);
    const { id } = await context.params;
    await deleteSavedPlan(session.user.id, id);
    return successResponse({ deleted: true as const }, requestId);
  } catch (error) {
    return failureResponse(error, requestId, route, startedAt);
  }
}
