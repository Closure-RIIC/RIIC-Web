"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { AgentRuntime } from "@/agent-runtime";
import { useWebsiteSession } from "@/website-session";
import { useFeatureAccess } from "@/components/workbench/FeatureAccessProvider";

const RuntimeContext = createContext<AgentRuntime | null>(null);

export function AgentRuntimeProvider({ children }: { children: ReactNode }) {
  const [runtime] = useState(() => new AgentRuntime());
  useEffect(() => {
    window.addEventListener("pagehide", runtime.flush);
    return () => {
      window.removeEventListener("pagehide", runtime.flush);
      runtime.dispose();
    };
  }, [runtime]);
  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>;
}

export function useAgentRuntime() {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("AgentRuntimeProvider is required");
  return runtime;
}

export function AgentRuntimeAccountBoundary() {
  const runtime = useAgentRuntime();
  const { data, isPending } = useWebsiteSession();
  const features = useFeatureAccess();
  const owner = features.agent ? data?.user.id ?? null : null;
  useEffect(() => {
    if (!isPending) runtime.activateOwner(owner);
  }, [runtime, owner, isPending]);
  return null;
}

export function useAgentRunningConversations(owner: string | null) {
  const runtime = useAgentRuntime();
  useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getServerSnapshot);
  return runtime.runningConversationIds(owner);
}
