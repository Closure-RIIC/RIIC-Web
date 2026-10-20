import "@tanstack/react-start/server-only";
import { assertSameOrigin, createRequestId, enforceRateLimit, failureResponse, PublicApiError, readJsonBody, requestClientIp, successResponse } from "../api-contract.ts";
import { requireWebsiteAdmin, requireWebsiteReviewer } from "../auth/authorization.ts";
import { findFeedbackRecord, findPlanRunRecord } from "../business-records.ts";
import { readFeedbackReproduction } from "../infra.ts";
import { createDraft, readDraft, editDraft, listVersions, createBatch, readBatch, listBatches, listDrafts, cancelBatch, retryFailed, readAttempt } from "./service.ts";
import { requestBundleSync } from "./bundles.ts";
import { readArtifact } from "./storage.ts";
import { relatedFeedback, linkFeedback } from "./related.ts";
import { acceptImport } from "./import-preview.ts";

function id(value: unknown) { if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new PublicApiError("AIC-REQ-1001"); return value; }
export async function qualityApi(request: Request) {
  const requestId = createRequestId();
  const start = performance.now();
  let response: Response;
  try {
    const actor = await requireWebsiteReviewer(request);
    const params = new URL(request.url).searchParams;
    let data: unknown;
    if (request.method === "GET") {
      switch (params.get("kind")) {
        case "related": data = await relatedFeedback(id(params.get("id"))); break;
        case "draft": data = await readDraft(id(params.get("id"))); break;
        case "batch": data = await readBatch(id(params.get("id"))); break;
        case "result": data = await readAttempt(id(params.get("id")), id(params.get("attempt"))); break;
        default: data = { versions: await listVersions(), batches: await listBatches(), drafts: await listDrafts(), isAdmin: actor.isAdmin,
          worker: await readArtifact("heartbeat.json").catch(() => null) }; break;
      }
    } else {
      assertSameOrigin(request);
      enforceRateLimit("admin-quality", requestClientIp(request), 60, 10 * 60_000);
      const body = await readJsonBody(request, 3 * 1024 * 1024) as Record<string, unknown>;
      switch (body?.action) {
        case "acceptImport": {
          if (!Array.isArray(body.excluded) || body.excluded.length > 500) throw new PublicApiError("AIC-REQ-1001");
          data = await acceptImport(id(body.token), body.excluded.map(id), actor.userId); break;
        }
        case "link": await linkFeedback(id(body.id), body.masterId === null ? null : id(body.masterId), actor.userId, typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : ""); data = { updated: true }; break;
        case "feedback": {
          const ids = body.ids === undefined ? [id(body.id)] : Array.isArray(body.ids) ? body.ids.map(id) : [];
          if (!ids.length || ids.length > 500) throw new PublicApiError("AIC-REQ-1001");
          const drafts = [];
          for (const feedbackId of [...new Set(ids)]) {
          const item = await findFeedbackRecord(feedbackId);
          if (!item) throw new PublicApiError("AIC-DATA-8004");
          const run = await findPlanRunRecord(item.diagnosticId);
          const reproduction = await readFeedbackReproduction(item.id, item.diagnosticId, { expiresAt: item.expiresAt, plan: { rotation: run?.rotation, fiammettaEnabled: run?.fiammettaEnable, artifactKey: run?.artifactKey, artifactStatus: run?.artifactStatus, executionSource: run?.executionSource, expiresAt: run?.expiresAt } });
          if (!reproduction.available) throw new PublicApiError("AIC-FEEDBACK-4001", { message: `无法创建完整复现：${reproduction.unavailableReason}` });
          drafts.push(await createDraft({ operbox: reproduction.operbox, layout: reproduction.layout, rotation: reproduction.rotation, fiammetta_enable: reproduction.fiammettaEnabled, diagnosticId: item.diagnosticId }, actor.userId, [{ feedbackId: item.id, name: item.id }], item.expiresAt));
          }
          data = body.ids === undefined ? drafts[0] : drafts;
          break;
        }
        case "draft": data = await createDraft(body.input, actor.userId, [{ name: "Uploaded reproduction" }]); break;
        case "edit": data = await editDraft(id(body.id), Number(body.revision), body.input); break;
        case "batch": {
          if (!Array.isArray(body.ids) || !Array.isArray(body.bundleIds) || typeof body.label !== "string") throw new PublicApiError("AIC-REQ-1001");
          data = await createBatch(body.ids.map(id), body.bundleIds.map(id), body.label, actor.userId); break;
        }
        case "cancel": await cancelBatch(id(body.id)); data = { cancelled: true }; break;
        case "retry": await retryFailed(id(body.id)); data = { queued: true }; break;
        case "sync": await requireWebsiteAdmin(request); data = await requestBundleSync(); break;
        default: throw new PublicApiError("AIC-REQ-1001");
      }
    }
    response = successResponse(data, requestId);
  } catch (error) { response = failureResponse(error, requestId, "/api/admin/quality", start); }
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}
