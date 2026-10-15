"use client";

import { useEffect } from "react";

import { usePathname } from "@/navigation";

export function TelemetryLoader() {
  const pathname = usePathname();
  const isAdminPreview = pathname === "/admin-preview" || pathname.startsWith("/admin-preview/");
  useEffect(() => {
    if (isAdminPreview) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void import("./TelemetryRuntime")
      .then(({ startTelemetryRuntime }) => {
        if (disposed) return;
        stop = startTelemetryRuntime(window.location.pathname);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      stop?.();
    };
  }, [isAdminPreview]);
  useEffect(() => {
    if (isAdminPreview) return;
    void import("./TelemetryRuntime")
      .then(({ trackTelemetryPage }) => trackTelemetryPage(pathname))
      .catch(() => undefined);
  }, [pathname, isAdminPreview]);
  return null;
}
