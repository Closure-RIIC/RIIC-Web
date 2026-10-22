import "@tanstack/react-start/server-only";

import type { AdminFeedbackFacility, AdminFeedbackStatus } from "@riic/arknights-domain/types";
import {
  isAdminFeedbackStatus,
  normalizeAdminFeedbackStatus,
  legacyAdminFeedbackStatus,
  toAdminFeedbackRecordData,
  toAdminPlanRunRecordData,
} from "@riic/platform-server/admin-record-dto";
import {
  assertSameOrigin,
  createRequestId,
  enforceRateLimit,
  failureResponse,
  PublicApiError,
  readJsonBody,
  requestClientIp,
  successResponse,
} from "@riic/platform-server/api-contract";
import { requireWebsiteReviewer } from "@riic/platform-server/auth/authorization";
import { isBusinessDatabaseReadEnabled } from "@riic/platform-server/business-config";
import {
  deleteFeedbackRecords,
  findFeedbackRecord,
  feedbackHistory,
  findPlanRunRecord,
  queryBusinessRecords,
  updateFeedbackRecord,
  updateFeedbackRecords,
} from "@riic/platform-server/business-records";
import { deleteFeedbackArtifacts, readFeedbackReproduction, readPlanReproduction } from "@riic/platform-server/infra";

type AdminRecordKind = "runs" | "feedback";
type AdminRecordRoute =
  | "/api/admin/records"
  | "/api/admin/plan-runs"
  | "/api/admin/plan-runs/[id]"
  | "/api/admin/feedback"
  | "/api/admin/feedback/[id]";

function date(value: string | null): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new PublicApiError("AIC-REQ-1001");
  return parsed;
}

function deprecated(response: Response, successor: string): Response {
  response.headers.set("Deprecation", "true");
  response.headers.set("Link", `<${successor}>; rel="successor-version"`);
  return response;
}

function noStore(response: Response): Response {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

function requireRecordDatabase(): void {
  if (!isBusinessDatabaseReadEnabled()) throw new PublicApiError("AIC-DATA-8002");
}

function recordId(value: string): string {
  const hasControlCharacter = [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (!value || value.length > 100 || hasControlCharacter) {
    throw new PublicApiError("AIC-REQ-1001");
  }
  return value;
}

function feedbackStatus(value: string | null, allowLegacy: boolean): AdminFeedbackStatus | undefined {
  if (!value) return undefined;
  const status = allowLegacy ? legacyAdminFeedbackStatus(value) : isAdminFeedbackStatus(value) ? value : null;
  if (!status) throw new PublicApiError("AIC-REQ-1001");
  return status;
}

const ADMIN_FEEDBACK_FACILITIES = new Set<AdminFeedbackFacility>([
  "trading",
  "manufacture",
  "power",
  "control",
  "dormitory",
  "meeting",
  "hire",
  "processing",
  "training",
  "solver",
  "unknown",
]);

function feedbackFacility(value: string | null): AdminFeedbackFacility | undefined {
  if (!value) return undefined;
  if (!ADMIN_FEEDBACK_FACILITIES.has(value as AdminFeedbackFacility)) {
    throw new PublicApiError("AIC-REQ-1001");
  }
  return value as AdminFeedbackFacility;
}

export async function handleListAdminRecords(
  request: Request,
  kind: AdminRecordKind,
  route: AdminRecordRoute,
  options: { allowLegacyStatus?: boolean } = {},
) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    await requireWebsiteReviewer(request);
    requireRecordDatabase();
    const params = new URL(request.url).searchParams;
    const status = kind === "feedback"
      ? feedbackStatus(params.get("status"), options.allowLegacyStatus === true)
      : params.get("status") ?? undefined;
    if (kind === "runs" && status && status !== "success" && status !== "failed") {
      throw new PublicApiError("AIC-REQ-1001");
    }
    const records = await queryBusinessRecords({
      kind,
      limit: Number(params.get("limit") ?? 50),
      offset: Number(params.get("offset") ?? 0),
      from: date(params.get("from")),
      to: date(params.get("to")),
      status,
      facility: kind === "feedback" ? feedbackFacility(params.get("facility")) : undefined,
      errorCode: params.get("errorCode") ?? undefined,
      solverExecutableSha256: params.get("solver") ?? undefined,
      search: params.get("q")?.slice(0, 200),
    });
    return noStore(successResponse({
      ...records,
      items: kind === "feedback"
        ? records.items.map((item) => toAdminFeedbackRecordData(item as unknown as Record<string, unknown>))
        : records.items.map((item) => toAdminPlanRunRecordData(item as unknown as Record<string, unknown>)),
    }, requestId));
  } catch (error) {
    return noStore(failureResponse(error, requestId, route, startedAt));
  }
}

async function updateAdminFeedback(
  request: Request,
  feedbackId: string,
  body: { status?: unknown; note?: unknown; expectedUpdatedAt?: unknown } | null,
  allowLegacyStatus = false,
) {
  assertSameOrigin(request);
  enforceRateLimit("admin-record-update", requestClientIp(request), 60, 10 * 60_000);
  const admin = await requireWebsiteReviewer(request);
  requireRecordDatabase();
  const status = allowLegacyStatus
    ? legacyAdminFeedbackStatus(body?.status)
    : isAdminFeedbackStatus(body?.status) ? body.status : null;
  if (
    !status
    || (body?.note !== undefined && typeof body.note !== "string")
    || (typeof body?.note === "string" && body.note.length > 2000)
    || (status === "ignored" && (typeof body?.note !== "string" || !body.note.trim()))
  ) throw new PublicApiError("AIC-REQ-1001");
  const updated = await updateFeedbackRecord({
    feedbackId: recordId(feedbackId),
    status,
    note: typeof body?.note === "string" ? body.note : "",
    actorUserId: admin.session.user.id,
    expectedUpdatedAt: typeof body?.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : undefined,
  });
  if (!updated) throw new PublicApiError("AIC-DATA-8004");
  return updated;
}

export async function handleUpdateAdminFeedback(
  request: Request,
  feedbackId: string,
  route: AdminRecordRoute = "/api/admin/feedback/[id]",
) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    const body = await readJsonBody(request, 16 * 1024) as { status?: unknown; note?: unknown; expectedUpdatedAt?: unknown } | null;
    return noStore(successResponse(await updateAdminFeedback(request, feedbackId, body), requestId));
  } catch (error) {
    return noStore(failureResponse(error, requestId, route, startedAt));
  }
}

export async function handleGetAdminFeedbackDetail(request: Request, feedbackId: string) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    await requireWebsiteReviewer(request);
    requireRecordDatabase();
    const item = await findFeedbackRecord(recordId(feedbackId));
    if (!item) throw new PublicApiError("AIC-DATA-8004");
    const run = await findPlanRunRecord(item.diagnosticId);
    const reproduction = await readFeedbackReproduction(item.id, item.diagnosticId, {
      expiresAt: item.expiresAt,
      plan: {
        rotation: run?.rotation,
        fiammettaEnabled: run?.fiammettaEnable,
        artifactKey: run?.artifactKey,
        artifactStatus: run?.artifactStatus,
        executionSource: run?.executionSource,
        expiresAt: run?.expiresAt,
      },
    });
    return noStore(successResponse({
      feedback: toAdminFeedbackRecordData(item as unknown as Record<string, unknown>),
      reproduction,
      history: (await feedbackHistory(item.id)).map((event) => ({ ...event, status: normalizeAdminFeedbackStatus(event.status), createdAt: event.createdAt.toISOString() })),
      solverExecutableSha256: run?.solverExecutableSha256 ?? null,
    }, requestId));
  } catch (error) {
    return noStore(failureResponse(error, requestId, "/api/admin/feedback/[id]", startedAt));
  }
}

export async function handleGetAdminPlanRunDetail(request: Request, diagnosticId: string) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    await requireWebsiteReviewer(request);
    requireRecordDatabase();
    const item = await findPlanRunRecord(recordId(diagnosticId));
    if (!item || item.status !== "failed") throw new PublicApiError("AIC-DATA-8004");
    const reproduction = await readPlanReproduction(item.diagnosticId, {
      rotation: item.rotation,
      fiammettaEnabled: item.fiammettaEnable,
      artifactKey: item.artifactKey,
      artifactStatus: item.artifactStatus,
      executionSource: item.executionSource,
      expiresAt: item.expiresAt,
    });
    return noStore(successResponse({
      run: toAdminPlanRunRecordData(item as unknown as Record<string, unknown>),
      reproduction,
    }, requestId));
  } catch (error) {
    return noStore(failureResponse(error, requestId, "/api/admin/plan-runs/[id]", startedAt));
  }
}

export async function handleDeleteAdminFeedback(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSameOrigin(request);
    enforceRateLimit("admin-feedback-delete", requestClientIp(request), 20, 10 * 60_000);
    await requireWebsiteReviewer(request);
    requireRecordDatabase();
    const body = await readJsonBody(request, 24 * 1024) as { ids?: unknown } | null;
    if (!Array.isArray(body?.ids) || body.ids.length < 1 || body.ids.length > 100) {
      throw new PublicApiError("AIC-REQ-1001");
    }
    const ids = [...new Set(body.ids.map((id) => recordId(typeof id === "string" ? id : "")))];
    // Remove private attachments first so a filesystem failure leaves the database
    // rows available for a safe retry instead of creating unreachable Box data.
    const privateArtifactsDeleted = await deleteFeedbackArtifacts(ids);
    const deletedIds = await deleteFeedbackRecords(ids);
    return noStore(successResponse({
      deletedIds,
      deletedCount: deletedIds.length,
      privateArtifactsDeleted,
    }, requestId));
  } catch (error) {
    return noStore(failureResponse(error, requestId, "/api/admin/feedback", startedAt));
  }
}

export async function handleBatchReviewFeedback(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSameOrigin(request);
    const admin = await requireWebsiteReviewer(request);
    requireRecordDatabase();
    enforceRateLimit("admin-record-update", requestClientIp(request), 60, 10 * 60_000);
    const body = await readJsonBody(request, 128 * 1024) as { items?: { id?: unknown; expectedUpdatedAt?: unknown }[]; status?: unknown; note?: unknown } | null;
    if (!Array.isArray(body?.items) || !body.items.length || body.items.length > 100 || !isAdminFeedbackStatus(body.status)
      || typeof body.note !== "string" || body.note.length > 2000 || (body.status === "ignored" && !body.note.trim())) throw new PublicApiError("AIC-REQ-1001");
    const status = body.status;
    const note = body.note;
    const inputs = body.items.map((item) => ({
      feedbackId: recordId(typeof item?.id === "string" ? item.id : ""),
      expectedUpdatedAt: typeof item?.expectedUpdatedAt === "string" ? item.expectedUpdatedAt : undefined,
      status, note, actorUserId: admin.session.user.id,
    }));
    if (new Set(inputs.map((item) => item.feedbackId)).size !== inputs.length) throw new PublicApiError("AIC-REQ-1001");
    return noStore(successResponse({ items: await updateFeedbackRecords(inputs) }, requestId));
  } catch (error) {
    return noStore(failureResponse(error, requestId, "/api/admin/feedback", startedAt));
  }
}

export async function handleLegacyAdminRecordsGet(request: Request) {
  const kindValue = new URL(request.url).searchParams.get("kind");
  const kind = kindValue === "feedback" ? "feedback" : kindValue === "runs" ? "runs" : null;
  if (!kind) {
    const requestId = createRequestId();
    return deprecated(
      noStore(failureResponse(new PublicApiError("AIC-REQ-1001"), requestId, "/api/admin/records", performance.now())),
      "/api/admin/plan-runs",
    );
  }
  const successor = kind === "runs" ? "/api/admin/plan-runs" : "/api/admin/feedback";
  return deprecated(await handleListAdminRecords(request, kind, "/api/admin/records", { allowLegacyStatus: true }), successor);
}

export async function handleLegacyAdminRecordsPatch(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  let successor = "/api/admin/feedback";
  try {
    const body = await readJsonBody(request, 16 * 1024) as {
      feedbackId?: unknown;
      expectedUpdatedAt?: unknown;
      status?: unknown;
      note?: unknown;
    } | null;
    const feedbackId = typeof body?.feedbackId === "string" ? body.feedbackId : "";
    successor = `/api/admin/feedback/${encodeURIComponent(feedbackId)}`;
    return deprecated(noStore(successResponse(
      await updateAdminFeedback(request, feedbackId, body, true),
      requestId,
    )), successor);
  } catch (error) {
    return deprecated(noStore(failureResponse(error, requestId, "/api/admin/records", startedAt)), successor);
  }
}
