"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useAccountFeatureAccess } from "@riic/shell/useAccountFeatureAccess";
import { NO_FEATURE_ACCESS, type FeatureAccess, type RestrictedFeature } from "@/feature-access";
import { useWebsiteSession } from "@/website-session";

const FeatureAccessContext = createContext<FeatureAccess>(NO_FEATURE_ACCESS);

export function FeatureAccessProvider({ children }: { children: ReactNode }) {
  const { data, isPending } = useWebsiteSession();
  const access = useAccountFeatureAccess(data?.user.id ?? null, isPending);
  return <FeatureAccessContext.Provider value={access}>{children}</FeatureAccessContext.Provider>;
}

export function useFeatureAccess() { return useContext(FeatureAccessContext); }

export function FeatureAccessBoundary({ feature, children }: { feature: RestrictedFeature; children: ReactNode }) {
  return useFeatureAccess()[feature] ? children : null;
}
