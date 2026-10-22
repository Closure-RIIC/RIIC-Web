"use client";

import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  requestWebsiteSession,
  type WebsiteSessionData,
} from "@/website-session-data";

export { parseWebsiteSession, type WebsiteSessionData } from "@/website-session-data";

interface WebsiteSessionContextValue {
  data: WebsiteSessionData | null;
  isPending: boolean;
  refetch: () => Promise<WebsiteSessionData | null>;
}

const WebsiteSessionContext = createContext<WebsiteSessionContextValue | null>(null);
export function WebsiteSessionProvider({ children, initialSession }: {
  children: ReactNode;
  initialSession?: WebsiteSessionData | null;
}) {
  // Only the first mount consumes the request-scoped SSR view. Later loader
  // invalidations cannot restore a previous account after sign-out.
  const [bootstrap] = useState(() => initialSession);
  const [data, setData] = useState<WebsiteSessionData | null>(() => initialSession ?? null);
  // Pending only covers initial resolution; background refreshes keep consumers mounted.
  const [isPending, setIsPending] = useState(initialSession === undefined);
  const activeRequest = useRef<Promise<WebsiteSessionData | null> | null>(null);
  const refetch = useCallback(async () => {
    const request = requestWebsiteSession();
    activeRequest.current = request;
    const next = await request;
    if (activeRequest.current !== request) return activeRequest.current;
    setData(next);
    setIsPending(false);
    return next;
  }, []);

  useEffect(() => {
    if (bootstrap !== undefined) return;
    let cancelled = false;
    const request = activeRequest.current ??= requestWebsiteSession();
    void request.then((next) => {
      if (cancelled || activeRequest.current !== request) return;
      setData(next);
      setIsPending(false);
    });
    return () => {
      cancelled = true;
    };
  }, [bootstrap]);

  useEffect(() => {
    const refresh = () => { void refetch(); };
    const restore = (event: PageTransitionEvent) => { if (event.persisted) refresh(); };
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", restore);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", restore);
    };
  }, [refetch]);

  const value = useMemo<WebsiteSessionContextValue>(() => ({
    data,
    isPending,
    refetch,
  }), [data, isPending, refetch]);

  return <WebsiteSessionContext.Provider value={value}>{children}</WebsiteSessionContext.Provider>;
}

export function useWebsiteSession(): WebsiteSessionContextValue {
  const value = useContext(WebsiteSessionContext);
  if (!value) throw new Error("网站 Session 必须在 WebsiteSessionProvider 内使用。");
  return value;
}
