export class SklandRequestError extends Error {
  status = 0;
  retryable = false;
  retryAfterSeconds?: number;
}

export async function sklandApi<T>(action: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(`/api/skland/${action}`, {
    method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", signal,
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok || result?.success !== true) {
    const error = new SklandRequestError(result?.error?.message || "森空岛服务暂不可用 / Skland is unavailable");
    error.status = response.status;
    error.retryable = result?.error?.retryable === true || response.status === 429 || response.status >= 500;
    const retryAfter = Number(response.headers.get("retry-after"));
    if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterSeconds = retryAfter;
    throw error;
  }
  return result.data as T;
}
