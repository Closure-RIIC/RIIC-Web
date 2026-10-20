"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { NO_FEATURE_ACCESS, type FeatureAccess, type RestrictedFeature } from "@/feature-access";
import { useWebsiteSession } from "@/website-session";

const FeatureAccessContext = createContext<FeatureAccess>(NO_FEATURE_ACCESS);

export function FeatureAccessProvider({ children }: { children: ReactNode }) {
  const { data, isPending } = useWebsiteSession();
  const owner = data?.user.id ?? null;
  const [resolved, setResolved] = useState<{ owner: string | null; access: FeatureAccess } | null>(null);
  useEffect(() => {
    if (isPending) return;
    let sequence = 0;
    const controller = new AbortController();
    async function refresh() {
      const current = ++sequence;
      let access = NO_FEATURE_ACCESS;
      try {
        const response = await fetch("/api/account/feature-access", { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (response.ok) {
          const value = await response.json();
          access = { agent: value?.agent === true, billing: value?.billing === true };
        }
      } catch { /* Fail closed on transport errors. */ }
      if (!controller.signal.aborted && current === sequence) setResolved({ owner, access });
    }
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { controller.abort(); window.removeEventListener("focus", onFocus); };
  }, [owner, isPending]);
  const access = !isPending && resolved?.owner === owner ? resolved.access : NO_FEATURE_ACCESS;
  return <FeatureAccessContext.Provider value={access}>{children}</FeatureAccessContext.Provider>;
}

export function useFeatureAccess() { return useContext(FeatureAccessContext); }

export function FeatureAccessBoundary({ feature, children }: { feature: RestrictedFeature; children: ReactNode }) {
  return useFeatureAccess()[feature] ? children : null;
}
