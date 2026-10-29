export class ReleaseRequestError extends Error {
  constructor(public status: number) { super("Release request failed"); }
}

export async function requestReleases<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, cache: "no-store", credentials: "same-origin",
    signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
  const value = await response.json();
  if (!response.ok || !value.success) throw new ReleaseRequestError(response.status);
  return value.data as T;
}
