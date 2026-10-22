"use client";

import { memo, useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StreamedText } from "./StreamedText";
import styles from "./AgentMotion.module.css";

/** Three visual lines, with the full text retained for scrolling and history. */
export const ReasoningPreview = memo(function ReasoningPreview({ text, running, expanded, animate }: { text: string; running: boolean; expanded: boolean; animate: boolean }) {
  const windowRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const windowElement = windowRef.current;
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!expanded || !windowElement || !viewport || !content) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let following = true;
    let initialized = false;

    const updateFade = () => {
      const fading = running && following && viewport.scrollTop > 1;
      if (windowElement.dataset.fading !== String(fading)) windowElement.dataset.fading = String(fading);
    };
    const follow = () => {
      if (!following) return;
      cancelAnimationFrame(frame);
      frame = 0;
      const target = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      // Initial/reopened content jumps straight to the latest lines. Only new
      // line wraps animate; no measurements or scrolling occur for each token.
      if (!initialized || !running || reducedMotion.matches) {
        initialized = true;
        viewport.scrollTop = target;
        updateFade();
        return;
      }
      const start = Math.max(viewport.scrollTop, target - viewport.clientHeight);
      const distance = target - start;
      if (Math.abs(distance) < 1) { updateFade(); return; }
      const startedAt = performance.now();
      const tick = (now: number) => {
        const progress = Math.min(1, (now - startedAt) / 160);
        viewport.scrollTop = start + distance * (1 - (1 - progress) ** 3);
        updateFade();
        frame = progress < 1 ? requestAnimationFrame(tick) : 0;
      };
      frame = requestAnimationFrame(tick);
    };
    const pause = () => { following = false; cancelAnimationFrame(frame); frame = 0; updateFade(); };
    const wheel = (event: WheelEvent) => { if (event.deltaY < 0) pause(); };
    const keydown = (event: KeyboardEvent) => { if (["ArrowUp", "PageUp", "Home"].includes(event.key)) pause(); };
    const scroll = () => {
      if (!following && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 2) following = true;
      updateFade();
    };
    const observer = new ResizeObserver(follow);
    observer.observe(content);
    observer.observe(viewport);
    viewport.addEventListener("wheel", wheel, { passive: true });
    viewport.addEventListener("touchstart", pause, { passive: true });
    viewport.addEventListener("pointerdown", pause);
    viewport.addEventListener("keydown", keydown);
    viewport.addEventListener("scroll", scroll, { passive: true });
    viewport.addEventListener("yeye-scrollbar-ready", follow);
    reducedMotion.addEventListener("change", follow);
    follow();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      viewport.removeEventListener("wheel", wheel);
      viewport.removeEventListener("touchstart", pause);
      viewport.removeEventListener("pointerdown", pause);
      viewport.removeEventListener("keydown", keydown);
      viewport.removeEventListener("scroll", scroll);
      viewport.removeEventListener("yeye-scrollbar-ready", follow);
      reducedMotion.removeEventListener("change", follow);
    };
  }, [expanded, running]);

  return <div ref={windowRef} className={styles.reasoningWindow} data-agent-reasoning-preview>
    <ScrollArea className="max-h-[54px]" viewportClassName="overscroll-contain pl-3 pr-2" viewportProps={{ ref: viewportRef }}>
      <div ref={contentRef} className={styles.reasoningContent}>
        <StreamedText text={text} animate={animate && running} />{running ? <span aria-hidden="true" className={styles.cursor} /> : null}
      </div>
    </ScrollArea>
  </div>;
});
