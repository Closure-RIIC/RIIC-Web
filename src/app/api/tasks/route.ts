import { validateLayoutJson } from "@/layout-validation";
import { assertOperbox } from "@/operbox";
import { normalizePersistedPlanData } from "@/persistence";
import { isRotationProfile } from "@/rotation-settings";
import {
  assertFiammettaEnableCompatible,
  assertPlanCollectionLimits,
  assertSameOrigin,
  createRequestId,
  enforceRateLimit,
  failureResponse,
  normalizeFiammettaEnable,
  planAccountAdmissionClass,
  PublicApiError,
  readJsonBody,
  requestClientIp,
  successResponse,
} from "@/server/api-contract";
import { websiteSession as readWebsiteSession } from "@/server/auth";
import { requireWebsiteSession } from "@/server/auth/authorization";
import {
  isAccountCloudSyncEnabled,
  isPlanTaskQueueEnabled,
  planCacheHmacKey,
  workspaceMasterKeys,
} from "@/server/business-config";
import { recordPlanRunBestEffort } from "@/server/business-records";
import { accountDataConsent } from "@/server/data-consent";
import { getCachedPlanCacheSolverIdentity, getSampleOperbox } from "@/server/infra";
import {
  evictPlanCacheKeys,
  lookupPlanCache,
  recordPlanCacheReferenceBestEffort,
} from "@/server/plan-cache";
import { planAccessMode } from "@/server/plan-access";
import { publicPlanSha256, resolveSavedPlanCalculationContext } from "@/server/plan-result-binding";
import { safeDisplayName } from "@/server/public-plan";
import { activeSklandAccount, readSklandAccountStore } from "@/server/skland/http";
import { sklandDataOwnerTag } from "@/server/skland/session";
import {
  createPlanTask,
  currentPlanTaskEtaSeconds,
  planQueuePosition,
  planSelectionPoolSize,
  planTaskIpHmac,
} from "@/server/plan-task";
import { planOperboxContentHmac } from "@/server/workspace-crypto";
import { validateSavedPlanCalculationContext } from "@/server/workspace-payload";
import type { BaseBlueprint, OperBoxEntry, RotationProfile } from "@/types";


type SubmitBody = {
  layout?: BaseBlueprint;
  operbox?: OperBoxEntry[];
  sourceName?: unknown;
  rotation?: unknown;
  boxSource?: unknown;
  fiammetta_enable?: unknown;
};

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ((error as { code?: unknown }).code === "23505") return true;
  return isUniqueViolation((error as { cause?: unknown }).cause);
}

export async function POST(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  try {
    assertSameOrigin(request);
    const ip = requestClientIp(request);
    // 登录账号在持久化队列中按账号优先限流；这里仅保留共享出口 IP 的高位防滥用上限。
    enforceRateLimit("plan-submit", ip, 1_000, 10 * 60_000, "AIC-PLAN-3007");

    const body = await readJsonBody(request, 2 * 1024 * 1024) as SubmitBody | null;
    if (!body) throw new PublicApiError("AIC-REQ-1001");

    let session: Awaited<ReturnType<typeof readWebsiteSession>> | null = null;
    if (planAccessMode(body.boxSource, body.operbox !== undefined) === "trusted-sample") {
      const sample = await getSampleOperbox();
      body.operbox = sample.operbox as OperBoxEntry[];
      body.sourceName = sample.sourceName;
      session = await readWebsiteSession(request).catch(() => null);
    } else {
      session = await requireWebsiteSession(request);
    }

    const layoutErrors = validateLayoutJson(body.layout);
    if (layoutErrors.length || !body.layout) {
      throw new PublicApiError("AIC-LAYOUT-1201", {
        fieldErrors: (layoutErrors.length ? layoutErrors : ["布局格式无效。"]).map((message) => ({
          path: "layout",
          code: "invalid_layout",
          message,
        })),
      });
    }
    if (!Array.isArray(body.operbox)) {
      throw new PublicApiError("AIC-BOX-1101", {
        fieldErrors: [{ path: "operbox", code: "invalid_operbox", message: "干员数据需要是数组。" }],
      });
    }

    let rotation: RotationProfile = "abc_12_6_6";
    if (body.rotation !== undefined) {
      if (!isRotationProfile(body.rotation)) {
        throw new PublicApiError("AIC-PLAN-3001", {
          fieldErrors: [{
            path: "rotation",
            code: "invalid_rotation",
            message: "换班参数不在当前求解器支持范围内。",
          }],
        });
      }
      rotation = body.rotation;
    }
    const fiammettaEnable = normalizeFiammettaEnable(body.fiammetta_enable);
    assertFiammettaEnableCompatible(fiammettaEnable, rotation);
    assertPlanCollectionLimits(body.operbox.length, body.layout.rooms.length, body.sourceName);

    let operbox: OperBoxEntry[];
    try {
      operbox = assertOperbox(body.operbox);
    } catch (error) {
      throw new PublicApiError("AIC-BOX-1101", {
        fieldErrors: [{
          path: "operbox",
          code: "invalid_operbox_entry",
          message: error instanceof Error ? error.message : "干员数据包含无效记录。",
        }],
        cause: error,
      });
    }

    const sourceName = safeDisplayName(body.sourceName, "已导入的干员数据");
    const sourceType = body.boxSource === "skland" ? "skland" : body.boxSource === "sample" ? "sample" : "maa";
    const userId = session?.user?.id ?? null;
    const cacheReferenceUserId = sourceType === "sample" ? null : userId;
    let dataOwnerTag: string | null = null;
    if (body.boxSource === "skland") {
      const account = activeSklandAccount(await readSklandAccountStore());
      if (account) dataOwnerTag = sklandDataOwnerTag(account.session.userId);
    }

    const calculationContext = validateSavedPlanCalculationContext({
      presetLabel: body.layout.template,
      layout: body.layout,
      rotationProfile: rotation,
      fiammettaEnabled: fiammettaEnable,
    });
    if (!calculationContext) throw new PublicApiError("AIC-LAYOUT-1201");

    let operboxContentHmac: string | null = null;
    let operboxHmacKeyVersion: string | null = null;
    if (userId && sourceType === "maa" && isAccountCloudSyncEnabled()) {
      try {
        if ((await accountDataConsent(userId)).current) {
          const { activeVersion, keys } = workspaceMasterKeys();
          const activeKey = keys.get(activeVersion);
          if (!activeKey) throw new Error("Active workspace key is unavailable.");
          operboxContentHmac = planOperboxContentHmac({ userId, operbox, masterKey: activeKey });
          operboxHmacKeyVersion = activeVersion;
        }
      } catch {
        console.error(JSON.stringify({ level: "error", event: "plan_operbox_binding_skipped", requestId }));
      }
    }

    const cacheSolver = getCachedPlanCacheSolverIdentity();
    if (cacheSolver) {
      const cache = await lookupPlanCache({
        layout: body.layout,
        operbox,
        sourceType,
        sourceName,
        rotation,
        fiammettaEnable,
        solver: cacheSolver,
      });
      if (cache.kind === "hit") {
        const persistedResult = normalizePersistedPlanData(cache.result, rotation);
        if (!persistedResult) throw new PublicApiError("AIC-SYS-5000");
        const savedPlanContext = operboxContentHmac && operboxHmacKeyVersion
          ? resolveSavedPlanCalculationContext(calculationContext, persistedResult)
          : null;
        const runStored = await recordPlanRunBestEffort({
          diagnosticId: cache.result.diagnosticId,
          userId,
          dataOwnerTag,
          sourceType,
          status: "success",
          layoutTemplate: body.layout.template,
          roomCount: body.layout.rooms.length,
          operatorCount: operbox.length,
          rotation,
          fiammettaEnable,
          durationMs: cache.result.durationMs,
          executionSource: "cache",
          solver: cacheSolver,
          artifact: null,
          calculationContext: savedPlanContext,
          publicResultSha256: savedPlanContext ? publicPlanSha256(persistedResult) : null,
          operboxContentHmac: savedPlanContext ? operboxContentHmac : null,
          operboxHmacKeyVersion: savedPlanContext ? operboxHmacKeyVersion : null,
        });
        const referenceStored = runStored && await recordPlanCacheReferenceBestEffort({
          cacheKeyHmac: cache.keyHmac,
          diagnosticId: cache.result.diagnosticId,
          userId: cacheReferenceUserId,
        });
        if (!referenceStored) await evictPlanCacheKeys([cache.keyHmac]).catch(() => undefined);
        return successResponse({ status: "done", result: cache.result }, requestId);
      }
    }

    if (!session?.user?.id) {
      throw new PublicApiError("AIC-AUTH-2008", {
        message: "请登录网站账号后再发起新的排班计算；未登录仍可使用已有缓存。",
      });
    }
    if (!isPlanTaskQueueEnabled()) throw new PublicApiError("AIC-PLAN-3001");

    let task;
    try {
      task = await createPlanTask({
        userId: session.user.id,
        accountClass: planAccountAdmissionClass(session.user),
        requestIpHmac: planTaskIpHmac(ip, planCacheHmacKey()),
        payload: {
          layout: body.layout,
          operbox,
          sourceName,
          sourceType,
          rotation,
          fiammettaEnable,
          layoutTemplate: body.layout.template,
          roomCount: body.layout.rooms.length,
          operatorCount: operbox.length,
          dataOwnerTag,
          calculationContext,
          operboxContentHmac,
          operboxHmacKeyVersion,
          cacheReferenceUserId,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new PublicApiError("AIC-PLAN-3005");
      throw error;
    }

    if (task.status === "buffered") {
      return successResponse({
        taskId: task.id,
        status: "buffered",
        selectionPoolSize: await planSelectionPoolSize(),
      }, requestId);
    }
    const queuePosition = await planQueuePosition(task.id);
    return successResponse({
      taskId: task.id,
      status: "pending",
      queuePosition,
      etaSeconds: await currentPlanTaskEtaSeconds(queuePosition),
    }, requestId);
  } catch (error) {
    return failureResponse(error, requestId, "/api/tasks", startedAt, "AIC-SYS-5000", request);
  }
}
