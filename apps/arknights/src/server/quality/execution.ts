import { QUALITY_TIMEOUT_MS } from "../../quality.ts";

/** Deadline covers transport retries as well as solver work. Always reap the child. */
export async function boundedExecution<T>(run: () => Promise<T>, stop: () => Promise<void>, options: { timeoutMs: number; cancelled: () => Promise<boolean>; pollMs?: number }) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let polling: ReturnType<typeof setInterval> | undefined;
  let checking = false;
  const interrupt = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Execution timed out")), Math.max(1, Math.min(options.timeoutMs, QUALITY_TIMEOUT_MS)));
    polling = setInterval(() => {
      if (checking) return;
      checking = true;
      void options.cancelled().then((cancelled) => { if (cancelled) reject(new Error("Execution cancelled")); }, () => reject(new Error("Execution source unavailable"))).finally(() => { checking = false; });
    }, options.pollMs ?? 1000);
  });
  try { return await Promise.race([run(), interrupt]); }
  finally { clearTimeout(timer); clearInterval(polling); await stop(); }
}
