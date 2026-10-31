import type {
  ApiFailure,
  ApiResponse,
  AccountDataConsentData,
  AccountDataConsentRequest,
  AppErrorCode,
  BaseBlueprint,
  DisplayError,
  FeedbackData,
  FeedbackRequest,
  CloudWorkspaceData,
  CloudWorkspacePutRequest,
  OperBoxEntry,
  PublicHealthData,
  PublicPlanData,
  RotationProfile,
  SampleOperboxData,
  SavedPlanData,
  SavedPlanListData,
  SklandQrStartData,
  SklandQrStatusData,
  SklandSessionData,
  SklandStatusData,
  SklandInventoryData,
} from "@riic/arknights-domain/types";
import type { SklandPolicyConsentRequest } from "@riic/platform/legal-policy";
import type { GameReportRecord, GameReportSource } from "@riic/arknights-domain/game-report";

const SKLAND_API_PREFIX = process.env.APP_CLIENT_SKLAND_API_PREFIX ?? "";

export class ApiClientError extends Error implements DisplayError {
  readonly code: AppErrorCode;
  readonly requestId?: string;
  readonly retryable: boolean;
  readonly retryAfterSeconds?: number;
  readonly fieldErrors?: ApiFailure["error"]["fieldErrors"];

  constructor(error: DisplayError) {
    super(error.message);
    this.name = "ApiClientError";
    this.code = error.code;
    this.requestId = error.requestId;
    this.retryable = error.retryable;
    this.retryAfterSeconds = error.retryAfterSeconds;
    this.fieldErrors = error.fieldErrors;
  }
}

function networkError(): ApiClientError {
  return new ApiClientError({
    code: "AIC-SYS-5000",
    message: "无法连接服务，请检查网络后重试。",
    retryable: true,
  });
}

function nonApiResponseError(path: string, response: Response): ApiClientError {
  const requestId = response.headers.get("X-Request-Id") ?? undefined;
  if (response.status === 429) {
    const retryAfter = response.headers.get("Retry-After")?.trim();
    const retryAfterSeconds = retryAfter && /^\d+$/.test(retryAfter)
      ? Number.parseInt(retryAfter, 10)
      : null;
    return new ApiClientError({
      code: path === "/api/plan" ? "AIC-PLAN-3002" : "AIC-RATE-6001",
      message: retryAfterSeconds !== null
        ? `请求过于频繁，请等待 ${retryAfterSeconds} 秒后重试。`
        : "请求过于频繁，请稍后重试。",
      requestId,
      retryable: true,
      ...(retryAfterSeconds !== null ? { retryAfterSeconds } : {}),
    });
  }

  return new ApiClientError({
    code: "AIC-SYS-5000",
    message: "服务返回了无法识别的响应，请稍后重试。",
    requestId,
    retryable: true,
  });
}

async function requestData<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    const headers = new Headers(init?.headers);
    headers.set("X-RIIC-Client-Version", process.env.APP_CLIENT_BUILD_ID ?? "local-development");
    headers.set("X-RIIC-Client-Schema", "2");
    response = await fetch(path, {...init, headers});
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw networkError();
  }

  const body = (await response.json().catch(() => null)) as ApiResponse<T> | null;
  if (body?.success === true) return body.data;
  if (body?.success === false) {
    const retryAfter = response.headers.get("Retry-After")?.trim();
    const retryAfterSeconds = retryAfter && /^\d+$/.test(retryAfter)
      ? Number.parseInt(retryAfter, 10)
      : undefined;
    throw new ApiClientError({
      ...body.error,
      retryAfterSeconds: body.error.retryAfterSeconds ?? retryAfterSeconds,
    });
  }
  throw nonApiResponseError(path, response);
}

function sklandApiPath(path: string): string {
  if (SKLAND_API_PREFIX) return `${SKLAND_API_PREFIX}${path}`;
  throw new ApiClientError({
    code: "AIC-AUTH-2007",
    message: "当前站点不提供此功能。",
    retryable: false,
  });
}

export function toDisplayError(error: unknown, fallback: string): DisplayError {
  if (error instanceof ApiClientError) {
    return {
      code: error.code,
      message: error.message,
      requestId: error.requestId,
      retryable: error.retryable,
      retryAfterSeconds: error.retryAfterSeconds,
      fieldErrors: error.fieldErrors,
    };
  }
  return {
    code: "AIC-SYS-5000",
    message: fallback,
    retryable: true,
  };
}

type PlanRequestOptions = {
  signal?: AbortSignal;
};

async function operboxPreflightError(value: unknown, code: "AIC-BOX-1101" | "AIC-DATA-8003"): Promise<ApiClientError | null> {
  // Keep progression data out of the cold-start API bundle; load it only for uploads.
  const { assertOperbox } = await import("@riic/arknights-domain/operbox");
  try {
    assertOperbox(value);
    return null;
  } catch (cause) {
    return new ApiClientError({
      code,
      message: cause instanceof Error ? cause.message : "干员练度数据无效，请检查后重新导入。",
      retryable: false,
    });
  }
}

export async function computePlan(payload: {
  layout: BaseBlueprint;
  operbox: OperBoxEntry[];
  sourceName: string | null;
  boxSource: "skland" | "maa" | "sample";
  rotation: RotationProfile;
  fiammetta_enable?: boolean;
}, options: PlanRequestOptions = {}): Promise<PublicPlanData> {
  const invalid = payload.boxSource === "sample" ? null : await operboxPreflightError(payload.operbox, "AIC-BOX-1101");
  if (invalid) return Promise.reject(invalid);
  const requestPayload = payload.boxSource === "sample"
    ? { layout: payload.layout, sourceName: payload.sourceName, boxSource: payload.boxSource, rotation: payload.rotation, fiammetta_enable: payload.fiammetta_enable }
    : payload;
  return requestData("/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestPayload),
    signal: options.signal,
  });
}

export type PlanTaskStatus = "buffered" | "pending" | "running" | "done" | "failed" | "cancelled";

export type PlanTaskSubmitData = {
  status: "done";
  result: PublicPlanData;
} | {
  taskId: string;
  status: "buffered" | "pending";
  queuePosition?: number;
  etaSeconds?: number;
  selectionPoolSize?: number;
};

export type PlanTaskPollData = {
  taskId: string;
  status: PlanTaskStatus;
  queuePosition?: number;
  etaSeconds?: number;
  selectionPoolSize?: number;
  result?: PublicPlanData;
  error?: string | null;
};

export async function submitPlanTask(payload: {
  layout: BaseBlueprint;
  operbox: OperBoxEntry[];
  sourceName: string | null;
  boxSource: "skland" | "maa" | "sample";
  rotation: RotationProfile;
  fiammetta_enable?: boolean;
}): Promise<PlanTaskSubmitData> {
  const invalid = payload.boxSource === "sample" ? null : await operboxPreflightError(payload.operbox, "AIC-BOX-1101");
  if (invalid) return Promise.reject(invalid);
  const requestPayload = payload.boxSource === "sample"
    ? { layout: payload.layout, sourceName: payload.sourceName, boxSource: payload.boxSource, rotation: payload.rotation, fiammetta_enable: payload.fiammetta_enable }
    : payload;
  return requestData("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestPayload),
  });
}

export function pollPlanTask(taskId: string): Promise<PlanTaskPollData> {
  return requestData(`/api/tasks/${encodeURIComponent(taskId)}`);
}

export function cancelPlanTask(taskId: string): Promise<{
  taskId: string;
  cancelled: boolean;
  reason: "running" | "unavailable" | null;
}> {
  return requestData(`/api/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" });
}

export function getHealth(): Promise<PublicHealthData> {
  return requestData("/api/readiness");
}

export function getSklandAccounts(mode: "full" | "summary" = "full"): Promise<SklandSessionData> {
  return requestData(sklandApiPath(mode === "summary" ? "/accounts?mode=summary" : "/accounts"));
}

export function startSklandQr(consent: SklandPolicyConsentRequest, signal?: AbortSignal): Promise<SklandQrStartData> {
  return requestData(sklandApiPath("/auth/qr"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ consent }),
    signal,
  });
}

export function importSklandCredential(
  credential: string,
  consent: SklandPolicyConsentRequest,
): Promise<SklandSessionData> {
  return requestData(sklandApiPath("/auth/credential"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential, consent }),
  });
}

export function refreshSklandStatus(): Promise<SklandStatusData> {
  return requestData(sklandApiPath("/status/refresh"), { method: "POST" });
}

export function getSklandInventory(): Promise<SklandInventoryData> {
  return requestData(sklandApiPath("/inventory"));
}

export function getGameReport(): Promise<GameReportRecord | null> {
  return requestData("/api/account/game-report");
}

export function postGameReport(days: GameReportRecord["days"], sourceType: GameReportSource): Promise<GameReportRecord> {
  return requestData("/api/account/game-report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ days, sourceType }),
  });
}

export function pollSklandQr(scanId: string, signal?: AbortSignal): Promise<SklandQrStatusData> {
  return requestData(sklandApiPath("/auth/qr/status"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scanId }),
    signal,
  });
}

export function syncSkland(): Promise<SklandSessionData> {
  return requestData(sklandApiPath("/sync"), { method: "POST" });
}

export function syncSklandTraining(): Promise<SklandSessionData> {
  return requestData(sklandApiPath("/training-sync"), { method: "POST" });
}

export function selectSklandRole(accountId: string, uid: string): Promise<SklandSessionData> {
  return requestData(sklandApiPath("/role"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountId, uid }),
  });
}

export function deleteSklandAccount(accountId: string): Promise<SklandSessionData> {
  return requestData(sklandApiPath(`/accounts/${encodeURIComponent(accountId)}`), { method: "DELETE" });
}

export function deleteAllSklandAccountData(): Promise<{ deleted: true; runs: number; feedback: number }> {
  return requestData(sklandApiPath("/account-data"), { method: "DELETE" });
}

export function getSampleOperbox(): Promise<SampleOperboxData> {
  return requestData("/api/sample-operbox");
}

export function saveFeedback(payload: FeedbackRequest): Promise<FeedbackData> {
  return requestData("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function getAccountDataConsent(signal?: AbortSignal): Promise<AccountDataConsentData> {
  return requestData("/api/account/data-consent", { signal });
}

export function acceptAccountDataConsent(payload: AccountDataConsentRequest, signal?: AbortSignal): Promise<AccountDataConsentData> {
  return requestData("/api/account/data-consent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
}

export function revokeAccountDataConsent(): Promise<{ revoked: true; deleted: true }> {
  return requestData("/api/account/data-consent", { method: "DELETE" });
}

export function getCloudWorkspace(signal?: AbortSignal): Promise<CloudWorkspaceData> {
  return requestData("/api/workspace", { signal });
}

export async function putCloudWorkspace(payload: CloudWorkspacePutRequest, signal?: AbortSignal): Promise<CloudWorkspaceData> {
  const invalid = "state" in payload && payload.state.boxSource === "maa" ? await operboxPreflightError(payload.operbox, "AIC-DATA-8003") : null;
  if (invalid) return Promise.reject(invalid);
  return requestData("/api/workspace", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
}

export function getAccountSavedPlans(): Promise<SavedPlanListData> {
  return requestData("/api/account/saved-plans");
}

export function updateAccountSavedPlan(id: string, pinned: boolean): Promise<SavedPlanData> {
  return requestData(`/api/account/saved-plans/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pinned }),
  });
}

export function deleteAccountSavedPlan(id: string): Promise<{ deleted: true }> {
  return requestData(`/api/account/saved-plans/${encodeURIComponent(id)}`, { method: "DELETE" });
}
