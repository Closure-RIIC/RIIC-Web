import { createPlatformClient } from "@riic/platform/client";
export { PlatformRequestError as SklandRequestError } from "@riic/platform/client";

const client = createPlatformClient();

export async function sklandApi<T>(action: string, signal: AbortSignal, body?: unknown): Promise<T> {
  if (!/^[a-z-]+$/.test(action)) throw new Error("Invalid Skland action");
  return client.request<T>(`/api/skland/${action}`, { signal, body });
}
