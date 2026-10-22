"use client";

import { useEffect, useState } from "react";

const noAccess = { agent: false, billing: false };

/** Visibility follows the server and is discarded immediately when the account changes. */
export function useAccountFeatureAccess(owner: string | null, pending: boolean) {
  const [resolved, setResolved] = useState<{ owner: string | null; access: typeof noAccess } | null>(null);
  useEffect(() => {
    if (pending) return;
    let sequence = 0;
    const controller = new AbortController();
    async function refresh() {
      const current = ++sequence;
      let access = noAccess;
      try {
        const response = await fetch("/api/account/feature-access", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
        if (response.ok) {
          const value = await response.json();
          access = { agent: value?.agent === true, billing: value?.billing === true };
        }
      } catch { /* Keep restricted entries hidden when access cannot be confirmed. */ }
      if (!controller.signal.aborted && current === sequence) setResolved({ owner, access });
    }
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { controller.abort(); window.removeEventListener("focus", onFocus); };
  }, [owner, pending]);
  return !pending && resolved?.owner === owner ? resolved.access : noAccess;
}
