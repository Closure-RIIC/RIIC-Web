export async function galleryRequest<T>(_role: string, body?: unknown, signal?: AbortSignal, adminMode = false): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort(); else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 15_000);
  try {
    const response = await fetch(adminMode ? "/api/admin/schedule-gallery" : "/api/schedule-gallery", {
      method: body ? "POST" : "GET", signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json();
    if (!response.ok || !payload.success) throw new Error(`@gallery:${payload.galleryError ?? "request"}`);
    return payload.data as T;
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}
