import type { MaaJson, MaaOperatorSlot, MaaPlan } from "./types.ts";

const PRELOAD_CONCURRENCY = 2;
const IDLE_TIMEOUT_MS = 1_500;
const IDLE_FALLBACK_DELAY_MS = 500;
const SLOW_CONNECTION_TYPES = new Set(["slow-2g", "2g", "3g"]);

export interface PortraitConnection {
  effectiveType?: string;
  saveData?: boolean;
}

export interface IdleTaskScheduler {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
  setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
}

function operatorName(value: string | MaaOperatorSlot | null): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (value && typeof value.name === "string") return value.name.trim() || null;
  return null;
}

function planOperatorNames(plan: MaaPlan): string[] {
  const names = new Set<string>();
  for (const rooms of Object.values(plan.rooms)) {
    for (const room of rooms ?? []) {
      for (const operator of Array.isArray(room.operators) ? room.operators : []) {
        const name = operatorName(operator);
        if (name) names.add(name);
      }
    }
  }
  if (plan.Fiammetta?.enable) {
    const targets = plan.Fiammetta?.target;
    for (const target of Array.isArray(targets) ? targets : targets ? [targets] : []) {
      const name = target.trim();
      if (name) names.add(name);
    }
  }
  return [...names];
}

export function nextShiftPortraitUrls(
  maa: MaaJson,
  activeShift: number,
  portraitFor: (name: string) => string | undefined,
): string[] {
  const currentPlan = maa.plans[activeShift];
  const nextPlan = maa.plans[activeShift + 1];
  if (!currentPlan || !nextPlan) return [];

  const currentUrls = new Set(
    planOperatorNames(currentPlan)
      .map((name) => portraitFor(name))
      .filter((url): url is string => Boolean(url)),
  );
  return [...new Set(
    planOperatorNames(nextPlan)
      .map((name) => portraitFor(name))
      .filter((url): url is string => typeof url === "string" && !currentUrls.has(url)),
  )];
}

export function shouldPreloadPortraits(connection?: PortraitConnection): boolean {
  if (connection?.saveData) return false;
  return !SLOW_CONNECTION_TYPES.has(connection?.effectiveType?.toLowerCase() ?? "");
}

export function scheduleIdleTask(task: () => void, scheduler: IdleTaskScheduler): () => void {
  let cancelled = false;
  const run = () => {
    if (!cancelled) task();
  };

  if (scheduler.requestIdleCallback) {
    const handle = scheduler.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    return () => {
      cancelled = true;
      scheduler.cancelIdleCallback?.(handle);
    };
  }

  const handle = scheduler.setTimeout(run, IDLE_FALLBACK_DELAY_MS);
  return () => {
    cancelled = true;
    scheduler.clearTimeout(handle);
  };
}

export async function preloadWithConcurrency<T>(
  items: T[],
  load: (item: T) => Promise<void>,
  concurrency = PRELOAD_CONCURRENCY,
  signal?: AbortSignal,
) {
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (next < items.length && !signal?.aborted) {
      const item = items[next++];
      try { await load(item); } catch { /* 预加载失败不影响排班展示。 */ }
    }
  });
  await Promise.all(workers);
}

function preloadImage(url: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    let decoding = false;
    image.fetchPriority = "low";

    const finish = () => {
      if (settled) return;
      settled = true;
      image.removeEventListener("load", handleLoad);
      image.removeEventListener("error", finish);
      signal.removeEventListener("abort", handleAbort);
      resolve();
    };
    const handleLoad = () => {
      if (decoding || signal.aborted) return finish();
      decoding = true;
      if (typeof image.decode === "function") void image.decode().catch(() => undefined).finally(finish);
      else finish();
    };
    const handleAbort = () => {
      image.removeAttribute("src");
      finish();
    };

    image.addEventListener("load", handleLoad, { once: true });
    image.addEventListener("error", finish, { once: true });
    signal.addEventListener("abort", handleAbort, { once: true });
    if (signal.aborted) return handleAbort();
    image.src = url;
    if (image.complete) handleLoad();
  });
}

async function preloadNextShiftPortraits(maa: MaaJson, activeShift: number, signal: AbortSignal) {
  const { operatorPortraitFor } = await import("./operatorPortraits.ts");
  if (signal.aborted) return;
  const urls = nextShiftPortraitUrls(maa, activeShift, operatorPortraitFor);
  await preloadWithConcurrency(urls, (url) => preloadImage(url, signal), PRELOAD_CONCURRENCY, signal);
}

export function scheduleNextShiftPortraitPreload(maa: MaaJson, activeShift: number): () => void {
  if (typeof window === "undefined" || typeof Image === "undefined") return () => undefined;
  if (document.visibilityState !== "visible") return () => undefined;

  const connection = (navigator as Navigator & { connection?: PortraitConnection }).connection;
  if (!shouldPreloadPortraits(connection)) return () => undefined;

  if (!maa.plans[activeShift] || !maa.plans[activeShift + 1]) return () => undefined;

  const controller = new AbortController();
  const idleWindow = window as Window & Pick<IdleTaskScheduler, "requestIdleCallback" | "cancelIdleCallback">;
  const cancelIdle = scheduleIdleTask(
    () => void preloadNextShiftPortraits(maa, activeShift, controller.signal),
    {
      requestIdleCallback: idleWindow.requestIdleCallback?.bind(window),
      cancelIdleCallback: idleWindow.cancelIdleCallback?.bind(window),
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
    },
  );

  return () => {
    cancelIdle();
    controller.abort();
  };
}
