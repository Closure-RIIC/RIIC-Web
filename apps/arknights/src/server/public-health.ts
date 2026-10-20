import { getHealth } from "./infra";
import { areRateLimitsEnabled, isDebugToolsEnabled } from "./api-contract";
import { isSklandFeatureEnabled } from "../deployment";
import type { PublicHealthData } from "../types";
import { isPlanTaskQueueEnabled } from "./business-config";
import { getPlanWorkerHealth } from "./plan-task";

/** Always probes live dependencies; deployment checks must not use a cached result. */
export async function probePublicHealth(): Promise<PublicHealthData> {
  const health = await getHealth();
  const taskQueueEnabled = isPlanTaskQueueEnabled();
  const expectedReleaseSha = process.env.APP_RELEASE_SHA?.trim() ?? "";
  const workerHealth = taskQueueEnabled
    ? await getPlanWorkerHealth({ expectedReleaseSha }).catch(() => ({ ready: false, releaseSha: null, heartbeatAt: null }))
    : { ready: false, releaseSha: null, heartbeatAt: null };
  const plannerReady = Boolean(health.ok && health.cliReady && (!taskQueueEnabled || workerHealth.ready));
  const sklandEnabled = isSklandFeatureEnabled();
  const sklandAvailable = Boolean(sklandEnabled && health.sklandConfigured && !health.sklandDisabledReason);
  return {
    status: plannerReady ? "ready" : "unavailable",
    plannerReady,
    taskQueue: {
      enabled: taskQueueEnabled,
      ready: taskQueueEnabled && workerHealth.ready,
      releaseMatched: taskQueueEnabled && workerHealth.releaseSha === expectedReleaseSha,
    },
    ...(sklandEnabled ? {
      skland: {
        available: sklandAvailable,
        message: sklandAvailable ? null : "当前未开放森空岛登录，可使用 MAA 导入。",
      },
    } : {}),
    features: { debugTools: isDebugToolsEnabled(), rateLimit: areRateLimitsEnabled() },
  };
}
