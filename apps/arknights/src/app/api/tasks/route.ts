import { validateLayoutJson } from "@riic/arknights-domain/layout-validation";
import { assertOperbox } from "@riic/arknights-domain/operbox";
import { normalizePersistedPlanData } from "@riic/arknights-domain/persistence";
import { encodeRotationKey, isRotationProfile } from "@riic/arknights-domain/rotation-settings";
import type { RotationTiming } from "@riic/arknights-domain/types";
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
} from "@riic/platform-server/api-contract";
import { websiteSession as readWebsiteSession } from "@riic/platform-server/auth";
import { requireWebsiteSession } from "@riic/platform-server/auth/authorization";
import {
  isAccountCloudSyncEnabled,
  isPlanTaskQueueEnabled,
  planCacheHmacKey,
  workspaceMasterKeys,
} from "@riic/platform-server/business-config";
import { recordPlanRunBestEffort } from "@riic/platform-server/business-records";
import { accountDataConsent } from "@riic/platform-server/data-consent";
import { getCachedPlanCacheSolverIdentity, getSampleOperbox } from "@riic/platform-server/infra";
import {
  evictPlanCacheKeys,
  lookupPlanCache,
  recordPlanCacheReferenceBestEffort,
} from "@riic/platform-server/plan-cache";
import { planAccessMode } from "@/server/plan-access";
import { publicPlanSha256, resolveSavedPlanCalculationContext } from "@riic/platform-server/plan-result-binding";
import { safeDisplayName } from "@riic/platform-server/public-plan";
import { activeSklandAccount, readSklandAccountStore } from "@riic/platform-server/skland/http";
import { sklandDataOwnerTag } from "@riic/platform-server/skland/session";
import {
  createPlanTask,
  currentPlanTaskEtaSeconds,
  planQueuePosition,
  planSelectionPoolSize,
  planTaskIpHmac,
} from "@/server/plan-task";
import { planOperboxContentHmac } from "@riic/platform-server/workspace-crypto";
import { validateSavedPlanCalculationContext } from "@riic/platform-server/workspace-payload";
import type { BaseBlueprint, OperBoxEntry } from "@riic/arknights-domain/types";


type SubmitBody = {
  layout?: BaseBlueprint;
  operbox?: OperBoxEntry[];
  sourceName?: unknown;
  rotation?: unknown;
  boxSource?: unknown;
  fiammetta_enable?: unknown;
  supportCombinationsEnable?: unknown;
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

/** v7 自定义时长：{ topology, shift_hours }，班次数由拓扑决定。 */
function isRotationTiming(value: unknown): value is RotationTiming {
  if (typeof value === "string") return isRotationProfile(value);
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as { topology?: unknown; shift_hours?: unknown };
  const expected = record.topology === "main_backup" ? 2 : record.topology === "abc" ? 3 : null;
  if (expected === null) return false;
  if (!Array.isArray(record.shift_hours) || record.shift_hours.length !== expected) return false;
  return record.shift_hours.every((hour) => typeof hour === "number" && Number.isFinite(hour) && hour > 0);
}

    let rotation: RotationTiming = "abc_12_6_6";
    if (body.rotation !== undefined) {
      if (!isRotationTiming(body.rotation)) {
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
    // 自定义时长没有 named profile 语义，菲亚兼容性只对 named profile 检查。
    if (typeof rotation === "string") assertFiammettaEnableCompatible(fiammettaEnable, rotation);
    // 私有记录、缓存键与日志只接受字符串：自定义时长编码成 custom_zb_16_8 一类的
    // 键，既能区分不同时长，也能无损还原。求解请求仍发送 body.rotation 对象。
    const rotationKey = encodeRotationKey(rotation);
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
      // 计算上下文只接受换班方式的字符串形式，自定义时长用编码后的 key。
      rotationProfile: rotationKey,
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
        rotation: rotationKey,
        fiammettaEnable,
        solver: cacheSolver,
      });
      if (cache.kind === "hit") {
        const persistedResult = normalizePersistedPlanData(cache.result, rotationKey);
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
          rotation: rotationKey,
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
          rotation: rotationKey,
          fiammettaEnable,
          supportCombinationsEnable: body.supportCombinationsEnable === true,
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
