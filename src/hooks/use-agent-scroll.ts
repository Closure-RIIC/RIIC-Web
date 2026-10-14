"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** User intent owns the viewport until an explicit downward return or jump. */
export function useAgentScroll() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  const scrollbarInput = useRef<() => void>(() => {});
  const followLatest = useCallback(() => {
    following.current = true;
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
    setShowLatest(false);
  }, []);
  const onScrollbarPointerDown = useCallback(() => scrollbarInput.current(), []);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const root = viewport?.parentElement;
    if (!viewport || !root) return;
    let frame = 0;
    let previousTop = viewport.scrollTop;
    let previousHeight = viewport.clientHeight;
    let previousContentHeight = viewport.scrollHeight;
    let downIntent = false;
    let manualUntil = 0;
    let draggingScrollbar = false;
    let touchY: number | undefined;
    const observed = new Set<Element>();
    const update = () => {
      const remaining = Math.max(0, viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop);
      const overflow = viewport.scrollHeight > viewport.clientHeight + 2;
      root.style.setProperty("--conversation-fade-top", overflow && viewport.scrollTop > 2 ? "var(--conversation-edge)" : "0px");
      root.style.setProperty("--conversation-fade-bottom", overflow && remaining > 2 ? "var(--conversation-edge)" : "0px");
      setShowLatest(!following.current && remaining > 2);
      previousTop = viewport.scrollTop;
      previousHeight = viewport.clientHeight;
      previousContentHeight = viewport.scrollHeight;
    };
    const settle = () => {
      frame = 0;
      if (following.current) viewport.scrollTop = viewport.scrollHeight;
      update();
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(settle); };
    const pause = () => {
      following.current = false;
      downIntent = false;
      manualUntil = performance.now() + 1500;
      update();
    };
    const direction = (delta: number) => {
      if (delta < 0) pause();
      else if (delta > 0) { downIntent = true; manualUntil = performance.now() + 1500; }
    };
    const scroll = () => {
      const geometryChanged = previousHeight !== viewport.clientHeight || previousContentHeight !== viewport.scrollHeight;
      const movedDown = viewport.scrollTop > previousTop;
      const atBottom = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 2;
      // Layout/scroll anchoring events cannot silently resume a paused reader.
      if (!geometryChanged && !following.current && movedDown && atBottom && downIntent
        && (draggingScrollbar || performance.now() < manualUntil)) following.current = true;
      if (geometryChanged && following.current) schedule();
      update();
    };
    const wheel = (event: WheelEvent) => { if (!event.ctrlKey) direction(event.deltaY); };
    const touchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY; pause(); };
    const touchMove = (event: TouchEvent) => {
      const next = event.touches[0]?.clientY;
      if (next !== undefined && touchY !== undefined) direction(touchY - next);
      touchY = next;
    };
    const touchEnd = () => { touchY = undefined; };
    const keydown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest("input, textarea, select, button, a, [contenteditable=true]")) return;
      if (["ArrowUp", "PageUp", "Home"].includes(event.key) || (event.key === " " && event.shiftKey)) direction(-1);
      if (["ArrowDown", "PageDown", "End"].includes(event.key) || (event.key === " " && !event.shiftKey)) direction(1);
    };
    const pointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      pause();
      if (event.target === viewport) { draggingScrollbar = true; downIntent = true; }
    };
    scrollbarInput.current = () => { pause(); draggingScrollbar = true; downIntent = true; };
    const pointerUp = () => { draggingScrollbar = false; manualUntil = performance.now() + 1500; };
    const observer = new ResizeObserver(schedule);
    observer.observe(viewport);
    const observeChildren = () => {
      for (const child of observed) if (child.parentElement !== viewport) { observer.unobserve(child); observed.delete(child); }
      for (const child of viewport.children) if (!observed.has(child)) { observer.observe(child); observed.add(child); }
      schedule();
    };
    const mutation = new MutationObserver(observeChildren);
    mutation.observe(viewport, { childList: true });
    observeChildren();
    cancelAnimationFrame(frame);
    settle();
    viewport.addEventListener("scroll", scroll, { passive: true });
    viewport.addEventListener("wheel", wheel, { passive: true });
    viewport.addEventListener("touchstart", touchStart, { passive: true });
    viewport.addEventListener("touchmove", touchMove, { passive: true });
    viewport.addEventListener("touchend", touchEnd);
    viewport.addEventListener("touchcancel", touchEnd);
    viewport.addEventListener("pointerdown", pointerDown);
    viewport.addEventListener("keydown", keydown);
    viewport.addEventListener("yeye-scrollbar-ready", schedule);
    window.addEventListener("pointerup", pointerUp);
    window.addEventListener("pointercancel", pointerUp);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      mutation.disconnect();
      scrollbarInput.current = () => {};
      viewport.removeEventListener("scroll", scroll);
      viewport.removeEventListener("wheel", wheel);
      viewport.removeEventListener("touchstart", touchStart);
      viewport.removeEventListener("touchmove", touchMove);
      viewport.removeEventListener("touchend", touchEnd);
      viewport.removeEventListener("touchcancel", touchEnd);
      viewport.removeEventListener("pointerdown", pointerDown);
      viewport.removeEventListener("keydown", keydown);
      viewport.removeEventListener("yeye-scrollbar-ready", schedule);
      window.removeEventListener("pointerup", pointerUp);
      window.removeEventListener("pointercancel", pointerUp);
    };
  }, []);
  return { viewportRef, showLatest, followLatest, onScrollbarPointerDown };
}
