"use client";

import { useEffect } from "react";
import { isTouchViewport, observeScrollbars, scrollbarOptions } from "./overlay-scrollbars";

export function PageScrollbar() {
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void import("overlayscrollbars").then(({ OverlayScrollbars }) => {
      if (cancelled) return;
      let stopObserving = () => { /* Safe until the observer is installed. */ };
      let page: ReturnType<typeof OverlayScrollbars> | undefined;
      const coarse = window.matchMedia("(pointer: coarse)");
      const narrow = window.matchMedia("(max-width: 767px)");
      cleanup = () => {
        stopObserving();
        coarse.removeEventListener("change", refresh);
        narrow.removeEventListener("change", refresh);
        page?.destroy();
      };
      function refresh() {
        page?.destroy();
        page = undefined;
        if (!isTouchViewport() && !document.querySelector("[data-app-scroll-area]")) {
          page = OverlayScrollbars({
            target: document.body,
            cancel: { nativeScrollbarsOverlaid: false, body: false },
          }, scrollbarOptions("y"));
        }
      }
      refresh();
      stopObserving = observeScrollbars(OverlayScrollbars);
      coarse.addEventListener("change", refresh);
      narrow.addEventListener("change", refresh);
    }).catch(() => {
      // Import failure leaves the native scrollbars untouched.
      cleanup?.();
    });
    return () => { cancelled = true; cleanup?.(); };
  }, []);
  return null;
}
