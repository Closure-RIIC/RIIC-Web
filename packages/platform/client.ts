import { apiProblem } from "@riic/contracts/api";

export class PlatformRequestError extends Error {
  status = 0;
  retryable = false;
  retryAfterSeconds?: number;
  code?: string;
}

/** Same-origin transport; create a separate instance for each SSR request. */
export function createPlatformClient(transport: typeof fetch = (...args) => fetch(...args)) {
  return {
    async request<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal; decode?: (value: unknown) => T } = {}): Promise<T> {
      if (!path.startsWith("/api/") || path.startsWith("//")) throw new Error("Expected a same-origin API path");
      const response = await transport(path, {
        method: options.method ?? (options.body === undefined ? "GET" : "POST"),
        credentials: "same-origin", cache: "no-store", signal: options.signal,
        ...(options.body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(options.body) }),
      });
      const value: unknown = await response.json();
      if (!response.ok || !value || typeof value !== "object" || !("success" in value) || value.success !== true || !("data" in value)) {
        const problem = apiProblem(value);
        const error = new PlatformRequestError(problem.message);
        error.status = response.status;
        error.code = problem.code;
        error.retryable = problem.retryable || response.status === 429 || response.status >= 500;
        const retry = Number(response.headers.get("retry-after"));
        if (Number.isFinite(retry) && retry > 0) error.retryAfterSeconds = retry;
        throw error;
      }
      return options.decode ? options.decode(value.data) : value.data as T;
    },
  };
}
