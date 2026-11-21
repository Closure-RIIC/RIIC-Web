import { describePlanArtifact, getPlanCacheSolverIdentity, runPlan } from "@riic/platform-server/infra";
import { validateLayoutJson } from "@riic/arknights-domain/layout-validation";
import { assertOperbox } from "@riic/arknights-domain/operbox";
import { normalizePersistedPlanData } from "@riic/arknights-domain/persistence";
import {
  acquireAnonymousSamplePlanSlot,
  acquirePlanSlot,
  assertFiammettaEnableCompatible,
  assertPlanCollectionLimits,
  assertSameOrigin,
  createRequestId,
  failureResponse,
  normalizeFiammettaEnable,
  planAccountAdmissionClass,
  PublicApiError,
  readJsonBody,
  requestClientIp,
  successResponse,
} from "@riic/platform-server/api-contract";
import { safeDisplayName, toPublicPlanData } from "@riic/platform-server/public-plan";
import { encodeRotationKey, isRotationProfile } from "@riic/arknights-domain/rotation-settings";
import type { RotationTiming } from "@riic/arknights-domain/types";
import type { BaseBlueprint, OperBoxEntry, PublicPlanData, SavedPlanCalculationContext } from "@riic/arknights-domain/types";
import { activeSklandAccount, readSklandAccountStore } from "@riic/platform-server/skland/http";
import { sklandDataOwnerTag } from "@riic/platform-server/skland/session";
import { websiteSession as readWebsiteSession } from "@riic/platform-server/auth";
import { requireWebsiteSession } from "@riic/platform-server/auth/authorization";
import { localTestSession } from "@riic/platform-server/auth/local-test-account";
import { planAccessMode } from "@/server/plan-access";
import { recordPlanRunBestEffort } from "@riic/platform-server/business-records";
import { isAccountCloudSyncEnabled, isPlanTaskQueueEnabled, workspaceMasterKeys } from "@riic/platform-server/business-config";
import { accountDataConsent } from "@riic/platform-server/data-consent";
import { publicPlanSha256, resolveSavedPlanCalculationContext } from "@riic/platform-server/plan-result-binding";
import { validateSavedPlanCalculationContext } from "@riic/platform-server/workspace-payload";
import { planOperboxContentHmac } from "@riic/platform-server/workspace-crypto";
import type { AppErrorCode, PlanApiResponse } from "@riic/arknights-domain/types";
import {
  completePlanCache,
  evictPlanCacheKeys,
  recordPlanCacheReferenceBestEffort,
  releasePlanCacheLease,
  resolvePlanCache,
  type PlanCacheResolution,
} from "@riic/platform-server/plan-cache";


export async function POST(request: Request) {
  const requestId = createRequestId();
  const startedAt = performance.now();
  let release: (() => void) | undefined;
  let runResult: PlanApiResponse | undefined;
  let cacheLease: Extract<PlanCacheResolution, { kind: "lease" }> | undefined;
  let recordContext: {
    userId: string | null;
    dataOwnerTag: string | null;
    sourceType: "sample" | "maa" | "skland";
    layoutTemplate: string;
    roomCount: number;
    operatorCount: number;
    /** 换班方式的字符串形式：named profile 或 custom_zb_16_8 一类的编码。 */
    rotation: string;
    fiammettaEnable: boolean;
    solverContext: SavedPlanCalculationContext;
    operboxContentHmac: string | null;
    operboxHmacKeyVersion: string | null;
  } | undefined;
  const recordRun = async (
    status: "success" | "failed",
    errorCode: AppErrorCode | null,
    publicResult?: PublicPlanData,
  ): Promise<boolean> => {
    if (!runResult || !recordContext) return false;
    const persistedResult = publicResult
      ? normalizePersistedPlanData(publicResult, recordContext.rotation)
      : null;
    const calculationContext = persistedResult && recordContext.operboxContentHmac && recordContext.operboxHmacKeyVersion
      ? resolveSavedPlanCalculationContext(recordContext.solverContext, persistedResult)
      : null;
    return recordPlanRunBestEffort({
      diagnosticId: runResult.runId ?? requestId,
      ...recordContext,
      status,
      durationMs: runResult.durationMs ?? Math.max(0, Math.round(performance.now() - startedAt)),
      executionSource: "solver",
      solverDurationMs: runResult.solverDurationMs ?? null,
      errorCode,
      solver: runResult.solver,
      artifact: await describePlanArtifact(runResult),
      calculationContext,
      publicResultSha256: calculationContext && persistedResult ? publicPlanSha256(persistedResult) : null,
      operboxContentHmac: calculationContext ? recordContext.operboxContentHmac : null,
      operboxHmacKeyVersion: calculationContext ? recordContext.operboxHmacKeyVersion : null,
      createdAt: runResult.startedAt ? new Date(runResult.startedAt) : new Date(),
    });
  };
  try {
    const includeDebug = new URL(request.url).searchParams.get("beta") === "1";
    assertSameOrigin(request);
    const taskQueueEnabled = isPlanTaskQueueEnabled();
    const ip = requestClientIp(request);

    const body = await readJsonBody(request, 2 * 1024 * 1024) as {
      layout?: BaseBlueprint;
      operbox?: OperBoxEntry[];
      sourceName?: unknown;
      rotation?: unknown;
      boxSource?: unknown;
      fiammetta_enable?: unknown;
    };
    let websiteUserId: string | null = null;
    let websiteAccountClass: "new" | "established" | null = null;
    const accessMode = planAccessMode(body.boxSource, body.operbox !== undefined);
    if (taskQueueEnabled && accessMode !== "trusted-sample") {
      throw new PublicApiError("AIC-PLAN-3001");
    }
    if (accessMode === "trusted-sample") {
      const sample = await (await import("@riic/platform-server/infra")).getSampleOperbox();
      body.operbox = sample.operbox as OperBoxEntry[];
      body.sourceName = "243 全精二示例";
      const optionalSession = localTestSession(request) ?? await readWebsiteSession(request).catch(() => null);
      if (optionalSession?.user?.id) {
        websiteUserId = optionalSession.user.id;
        websiteAccountClass = planAccountAdmissionClass(optionalSession.user);
      }
    } else {
      const websiteSession = localTestSession(request) ?? await requireWebsiteSession(request);
      websiteUserId = websiteSession.user.id;
      websiteAccountClass = planAccountAdmissionClass(websiteSession.user);
    }
    const layoutErrors = validateLayoutJson(body?.layout);
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
        fieldErrors: [{
          path: "operbox",
          code: "invalid_operbox",
          message: "干员数据需要是数组。",
        }],
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
    const sourceType = body.boxSource === "skland" ? "skland" : body.boxSource === "sample" ? "sample" : "maa";
    // Sample inputs are global server data. A website identity may authorize a
    // cache miss, but it must never become the owner of that shared cache entry.
    const cacheReferenceUserId = sourceType === "sample" ? null : websiteUserId;
    let operboxContentHmac: string | null = null;
    let operboxHmacKeyVersion: string | null = null;
    if (websiteUserId && sourceType === "maa" && isAccountCloudSyncEnabled()) {
      try {
        if ((await accountDataConsent(websiteUserId)).current) {
          const { activeVersion, keys } = workspaceMasterKeys();
          const activeKey = keys.get(activeVersion);
          if (!activeKey) throw new Error("Active workspace key is unavailable.");
          operboxContentHmac = planOperboxContentHmac({ userId: websiteUserId, operbox, masterKey: activeKey });
          operboxHmacKeyVersion = activeVersion;
        }
      } catch {
        console.error(JSON.stringify({ level: "error", event: "plan_operbox_binding_skipped", requestId }));
      }
    }
    recordContext = {
      userId: websiteUserId,
      dataOwnerTag,
      sourceType,
      layoutTemplate: body.layout.template,
      roomCount: body.layout.rooms.length,
      operatorCount: operbox.length,
      rotation: rotationKey,
      fiammettaEnable,
      solverContext: calculationContext,
      operboxContentHmac,
      operboxHmacKeyVersion,
    };
    if (!includeDebug) {
      const cacheSolver = await getPlanCacheSolverIdentity();
      if (cacheSolver) {
        const cache = await resolvePlanCache({
          layout: body.layout,
          operbox,
          sourceType: recordContext.sourceType,
          sourceName,
          rotation: rotationKey,
          fiammettaEnable,
          solver: cacheSolver,
        });
        if (cache.kind === "hit") {
          const persistedResult = normalizePersistedPlanData(cache.result, rotationKey);
          if (!persistedResult) throw new PublicApiError("AIC-SYS-5000");
          const savedPlanContext = recordContext.operboxContentHmac && recordContext.operboxHmacKeyVersion
            ? resolveSavedPlanCalculationContext(recordContext.solverContext, persistedResult)
            : null;
          const runStored = await recordPlanRunBestEffort({
            diagnosticId: cache.result.diagnosticId,
            ...recordContext,
            status: "success",
            durationMs: cache.result.durationMs,
            executionSource: "cache",
            solver: cacheSolver,
            artifact: null,
            calculationContext: savedPlanContext,
            publicResultSha256: savedPlanContext ? publicPlanSha256(persistedResult) : null,
            operboxContentHmac: savedPlanContext ? recordContext.operboxContentHmac : null,
            operboxHmacKeyVersion: savedPlanContext ? recordContext.operboxHmacKeyVersion : null,
          });
          const referenceStored = runStored && await recordPlanCacheReferenceBestEffort({
            cacheKeyHmac: cache.keyHmac,
            diagnosticId: cache.result.diagnosticId,
            userId: cacheReferenceUserId,
          });
          if (!referenceStored) await evictPlanCacheKeys([cache.keyHmac]).catch(() => undefined);
          return successResponse(cache.result, requestId);
        }
        if (cache.kind === "lease") cacheLease = cache;
      }
    }
    // Only an actual cache miss occupies scarce solver capacity. The anonymous
    // onboarding trial is restricted to the server-owned sample and a dedicated,
    // lower-priority admission; personal inputs still require a website account.
    if (!websiteUserId || !websiteAccountClass) {
      if (accessMode !== "trusted-sample" || includeDebug) {
        throw new PublicApiError("AIC-AUTH-2008", {
          message: "请登录网站账号后再发起新的排班计算；未登录仍可使用可信示例。",
        });
      }
      release = acquireAnonymousSamplePlanSlot({ ip });
    } else {
      release = acquirePlanSlot({ ip, accountId: websiteUserId, accountClass: websiteAccountClass });
    }
    runResult = await runPlan({ layout: body.layout, operbox, sourceName, rotation, fiammettaEnable, dataOwnerTag });
    const publicResult = toPublicPlanData(
      runResult,
      { layoutLabel: body.layout.template, sourceName, layout: body.layout },
      requestId,
      { includeDebug }
    );
    const runStored = await recordRun("success", null, publicResult);
    if (cacheLease) {
      const activeLease = cacheLease;
      if (!runStored || runResult.fallbackUsed) {
        await releasePlanCacheLease(activeLease);
        cacheLease = undefined;
      } else {
        try {
          const referenceStored = await recordPlanCacheReferenceBestEffort({
            cacheKeyHmac: activeLease.keyHmac,
            diagnosticId: publicResult.diagnosticId,
            userId: cacheReferenceUserId,
          });
          if (!referenceStored) {
            await releasePlanCacheLease(activeLease);
          } else {
            // Publish only after the user reference is durable. Revocation takes
            // the same account lock and may delete this lease before the update,
            // in which case completePlanCache safely becomes a no-op.
            await completePlanCache(activeLease, publicResult);
          }
          cacheLease = undefined;
        } catch {
          await releasePlanCacheLease(activeLease);
          cacheLease = undefined;
        }
      }
    }
    return successResponse(
      publicResult,
      requestId
    );
  } catch (error) {
    if (cacheLease) await releasePlanCacheLease(cacheLease);
    await recordRun("failed", error instanceof PublicApiError ? error.code : "AIC-SYS-5000");
    return failureResponse(error, requestId, "/api/plan", startedAt, "AIC-SYS-5000", request);
  } finally {
    release?.();
  }
}
