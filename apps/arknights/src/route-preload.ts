/** A single speculative code download; keep only the user's latest intention. */
export function createIntentPreloader(load: (key: string) => Promise<void>, allowed: () => boolean, delay = 50) {
  const completed = new Set<string>();
  let active: string | undefined;
  let pending: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { clearTimeout(timer); timer = undefined; pending = undefined; };
  const drain = () => {
    if (active || timer || !pending) return;
    const key = pending;
    pending = undefined;
    if (!allowed() || completed.has(key)) return;
    active = key;
    void Promise.resolve().then(() => load(key)).then(() => {
      completed.add(key);
    }).catch(() => {
      // A speculative failure must not affect navigation; another intent can retry.
    }).finally(() => { active = undefined; drain(); });
  };
  return {
    schedule(key: string) {
      clear();
      if (!allowed() || completed.has(key) || active === key) return;
      pending = key;
      timer = setTimeout(() => { timer = undefined; drain(); }, delay);
    },
    cancel(key?: string) { if (key === undefined || pending === key) clear(); },
  };
}

export function permitsPreload(connection?: { saveData?: boolean; effectiveType?: string }) {
  return !connection?.saveData && !["slow-2g", "2g", "3g"].includes(connection?.effectiveType ?? "");
}
