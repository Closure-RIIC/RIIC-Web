"use client";

import { useEffect } from "react";

/** Keep the mobile chat shell inside the area actually visible above the keyboard. */
export function useAgentViewport(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    const mobile = window.matchMedia("(max-width: 767px), (hover: none) and (pointer: coarse)");
    const viewport = window.visualViewport;
    let frame = 0;

    const reset = () => {
      delete root.dataset.agentViewport;
      delete root.dataset.agentKeyboard;
      root.style.removeProperty("--agent-viewport-height");
      root.style.removeProperty("--agent-viewport-top");
    };
    const update = () => {
      frame = 0;
      if (!mobile.matches) {
        reset();
        return;
      }
      // Pinch zoom must remain browser-controlled; it is not a keyboard resize.
      if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
      const height = viewport?.height ?? window.innerHeight;
      const typing = document.activeElement?.matches("[data-agent-prompt-bar] textarea") ?? false;
      root.dataset.agentViewport = "";
      root.style.setProperty("--agent-viewport-height", `${height}px`);
      root.style.setProperty("--agent-viewport-top", `${viewport?.offsetTop ?? 0}px`);
      root.toggleAttribute("data-agent-keyboard", typing && (window.innerHeight - height > 120 || height < 500));
      // iOS can leave the document scrolled after focusing/blurring a textarea.
      // The chat has its own scroll area, so document scrolling is never needed here.
      if (window.scrollY !== 0) window.scrollTo({ top: 0, behavior: "instant" });
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    update();
    mobile.addEventListener("change", schedule);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      mobile.removeEventListener("change", schedule);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
      reset();
    };
  }, [enabled]);
}
