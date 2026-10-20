"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiResponse } from "../types";
import type { ReleaseFeed } from "./types";

export function useReleaseFeed(announcementOnly = false) {
  const [feed, setFeed] = useState<ReleaseFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(false);
    const timeout = setTimeout(() => controller.abort(new Error("Release feed timed out")), 10_000);
    try {
      const response = await fetch(announcementOnly ? "/api/releases?mode=announcement" : "/api/releases", {
        cache: "no-store", credentials: "omit", signal: controller.signal,
      });
      const body = await response.json() as ApiResponse<ReleaseFeed>;
      if (!response.ok || !body.success || !["local", "development", "production"].includes(body.data.environment)
        || !Array.isArray(body.data.releases)) throw new Error("Invalid release feed");
      if (request.current === controller) setFeed(body.data);
    } catch {
      if (request.current === controller) { setFeed(null); setError(true); }
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) setLoading(false);
    }
  }, [announcementOnly]);

  useEffect(() => {
    void refresh();
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      request.current?.abort();
      request.current = null;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);
  return { feed, loading, error, refresh };
}
