import type { ApiResponse } from "@/types";

export async function requestAdminData<T>(url: string, init: RequestInit | undefined, fallback: string, request: typeof fetch = fetch): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("X-RIIC-Client-Version", process.env.APP_CLIENT_BUILD_ID ?? "local-development");
  headers.set("X-RIIC-Client-Schema", "2");
  const response = await request(url, { cache: "no-store", ...init, headers });
  let body: ApiResponse<T>;
  try { body = await response.json() as ApiResponse<T>; } catch { throw new Error(fallback); }
  if (!response.ok || !body.success) throw new Error(body.success ? fallback : body.error.message || fallback);
  return body.data;
}
