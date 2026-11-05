/** Bound optional resource work without allowing a late result to continue export. */
export async function withPosterTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Poster resource timeout")), ms);
    })]);
  } finally { clearTimeout(timer); }
}

/** Only reads are retried: POST may have succeeded even when its response was lost. */
export async function fetchPosterPayload(url: string, init: RequestInit = {}): Promise<unknown> {
  const attempts = !init.method || init.method === "GET" ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        if (response.status >= 500 && attempt + 1 < attempts) continue;
        throw new Error(`Poster HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      if (attempt + 1 < attempts && error instanceof Error && (error.name === "TypeError" || error.name === "AbortError")) continue;
      throw error;
    } finally { clearTimeout(timer); }
  }
  throw new Error("Poster request failed");
}
