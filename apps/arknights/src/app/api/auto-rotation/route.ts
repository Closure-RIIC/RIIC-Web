import { isAutoRotationHours } from "@riic/arknights-domain/auto-rotation";
import { validateLayoutJson } from "@riic/arknights-domain/layout-validation";
import { assertOperbox } from "@riic/arknights-domain/operbox";
import type { AutoRotationHours } from "@riic/arknights-domain/auto-rotation";
import type { BaseBlueprint, OperBoxEntry } from "@riic/arknights-domain/types";
import {
  acquireAnonymousSamplePlanSlot,
  acquirePlanSlot,
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
import { localTestSession } from "@riic/platform-server/auth/local-test-account";
import { requireWebsiteSession } from "@riic/platform-server/auth/authorization";
import { websiteSession as readWebsiteSession } from "@riic/platform-server/auth";
import { isPlanTaskQueueEnabled, planCacheHmacKey } from "@riic/platform-server/business-config";
import { getSampleOperbox, runAutoRotation } from "@riic/platform-server/infra";
import { planAccessMode } from "@/server/plan-access";
import {
  createSynchronousAutoRotationReservation,
  finishSynchronousAutoRotationReservation,
  planTaskIpHmac,
} from "@/server/plan-task";

type AutoRotationRequestBody = {
  layout?: BaseBlueprint;
  operbox?: OperBoxEntry[];
  boxSource?: unknown;
  hours?: unknown;
  fiammetta_enable?: unknown;
};

export type AutoRotationPostDependencies = {
  isAutoRotationHours: typeof isAutoRotationHours;
  validateLayoutJson: typeof validateLayoutJson;
  assertOperbox: typeof assertOperbox;
  acquireAnonymousSamplePlanSlot: typeof acquireAnonymousSamplePlanSlot;
  acquirePlanSlot: typeof acquirePlanSlot;
  assertPlanCollectionLimits: typeof assertPlanCollectionLimits;
  assertSameOrigin: typeof assertSameOrigin;
  createRequestId: typeof createRequestId;
  failureResponse: typeof failureResponse;
  normalizeFiammettaEnable: typeof normalizeFiammettaEnable;
  planAccountAdmissionClass: typeof planAccountAdmissionClass;
  readJsonBody: typeof readJsonBody;
  requestClientIp: typeof requestClientIp;
  successResponse: typeof successResponse;
  localTestSession: typeof localTestSession;
  requireWebsiteSession: typeof requireWebsiteSession;
  readWebsiteSession: typeof readWebsiteSession;
  isPlanTaskQueueEnabled: typeof isPlanTaskQueueEnabled;
  planCacheHmacKey: typeof planCacheHmacKey;
  getSampleOperbox: typeof getSampleOperbox;
  runAutoRotation: typeof runAutoRotation;
  planAccessMode: typeof planAccessMode;
  createSynchronousAutoRotationReservation: typeof createSynchronousAutoRotationReservation;
  finishSynchronousAutoRotationReservation: typeof finishSynchronousAutoRotationReservation;
  planTaskIpHmac: typeof planTaskIpHmac;
};

const defaultDependencies: AutoRotationPostDependencies = {
  isAutoRotationHours,
  validateLayoutJson,
  assertOperbox,
  acquireAnonymousSamplePlanSlot,
  acquirePlanSlot,
  assertPlanCollectionLimits,
  assertSameOrigin,
  createRequestId,
  failureResponse,
  normalizeFiammettaEnable,
  planAccountAdmissionClass,
  readJsonBody,
  requestClientIp,
  successResponse,
  localTestSession,
  requireWebsiteSession,
  readWebsiteSession,
  isPlanTaskQueueEnabled,
  planCacheHmacKey,
  getSampleOperbox,
  runAutoRotation,
  planAccessMode,
  createSynchronousAutoRotationReservation,
  finishSynchronousAutoRotationReservation,
  planTaskIpHmac,
};

export function createAutoRotationPost(dependencies: AutoRotationPostDependencies = defaultDependencies) {
  return async function post(request: Request) {
    const {
      isAutoRotationHours,
      validateLayoutJson,
      assertOperbox,
      acquireAnonymousSamplePlanSlot,
      acquirePlanSlot,
      assertPlanCollectionLimits,
      assertSameOrigin,
      createRequestId,
      failureResponse,
      normalizeFiammettaEnable,
      planAccountAdmissionClass,
      readJsonBody,
      requestClientIp,
      successResponse,
      localTestSession,
      requireWebsiteSession,
      readWebsiteSession,
      isPlanTaskQueueEnabled,
      planCacheHmacKey,
      getSampleOperbox,
      runAutoRotation,
      planAccessMode,
      createSynchronousAutoRotationReservation,
      finishSynchronousAutoRotationReservation,
      planTaskIpHmac,
    } = dependencies;
    const requestId = createRequestId();
    const startedAt = performance.now();
    let release: (() => void) | undefined;
    let reservationId: string | undefined;
    let reservationOutcome: "success" | "failed" | "cancelled" = "failed";
    try {
    assertSameOrigin(request);
    const ip = requestClientIp(request);
    const body = await readJsonBody(request, 2 * 1024 * 1024) as AutoRotationRequestBody;
    const accessMode = planAccessMode(body.boxSource, body.operbox !== undefined);

    let websiteUserId: string | null = null;
    let websiteAccountClass: "new" | "established" | null = null;
    if (accessMode === "trusted-sample") {
      body.operbox = (await getSampleOperbox()).operbox as OperBoxEntry[];
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

    const layoutErrors = validateLayoutJson(body.layout);
    if (layoutErrors.length || !body.layout) {
      throw new PublicApiError("AIC-LAYOUT-1201", {
        fieldErrors: (layoutErrors.length ? layoutErrors : ["基建布局格式无效。"]).map((message) => ({
          path: "layout",
          code: "invalid_layout",
          message,
        })),
      });
    }
    if (!isAutoRotationHours(body.hours)) {
      throw new PublicApiError("AIC-REQ-1001", {
        fieldErrors: [{
          path: "hours",
          code: "invalid_auto_rotation_hours",
          message: "自动轮换需要两个有限的正数时长，且每段至少为一分钟。",
        }],
      });
    }
    const hours: AutoRotationHours = body.hours;
    if (!Array.isArray(body.operbox)) {
      throw new PublicApiError("AIC-BOX-1101", {
        fieldErrors: [{
          path: "operbox",
          code: "invalid_operbox",
          message: "干员池必须是数组。",
        }],
      });
    }
    assertPlanCollectionLimits(body.operbox.length, body.layout.rooms.length, undefined);
    let operbox: OperBoxEntry[];
    try {
      operbox = assertOperbox(body.operbox);
    } catch (error) {
      throw new PublicApiError("AIC-BOX-1101", {
        fieldErrors: [{
          path: "operbox",
          code: "invalid_operbox_entry",
          message: error instanceof Error ? error.message : "干员池包含无效记录。",
        }],
        cause: error,
      });
    }
    const fiammettaEnable = normalizeFiammettaEnable(body.fiammetta_enable);

    if (!websiteUserId || !websiteAccountClass) {
      if (accessMode !== "trusted-sample") {
        throw new PublicApiError("AIC-AUTH-2008", {
          message: "请登录网站账号后再计算自动轮换；未登录时可使用全角色示例池。",
        });
      }
      release = acquireAnonymousSamplePlanSlot({ ip });
    } else if (isPlanTaskQueueEnabled()) {
      const reservation = await createSynchronousAutoRotationReservation({
        userId: websiteUserId,
        accountClass: websiteAccountClass,
        requestIpHmac: planTaskIpHmac(ip, planCacheHmacKey()),
      });
      reservationId = reservation.id;
    } else {
      release = acquirePlanSlot({ ip, accountId: websiteUserId, accountClass: websiteAccountClass });
    }

    const result = await runAutoRotation({
      layout: body.layout,
      operbox,
      hours,
      fiammettaEnable,
      signal: request.signal,
    });
    reservationOutcome = "success";
    return successResponse(result, requestId);
    } catch (error) {
      if (request.signal.aborted) reservationOutcome = "cancelled";
      return failureResponse(error, requestId, "/api/auto-rotation", startedAt, "AIC-SYS-5000", request);
    } finally {
      release?.();
      if (reservationId) {
        await finishSynchronousAutoRotationReservation(reservationId, reservationOutcome);
      }
    }
  };
}

export const POST = createAutoRotationPost();
