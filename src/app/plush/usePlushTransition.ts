"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PLUSH_SLIDE_DURATION, plushOrbitDirection, plushOrbitPose, plushSlidePosition } from "@/components/agent/plush-motion";

type Swap = { target: string; direction: number; snapshot: HTMLElement; animations: Animation[]; started: boolean };

/** Only the incoming character renders in WebGL; the outgoing frame is a 2D copy. */
export function usePlushTransition(ids: readonly string[]) {
  const [selected, setSelected] = useState(ids[0]);
  const selectedRef = useRef(ids[0]);
  const galleryRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const swapRef = useRef<Swap | null>(null);
  const pendingRef = useRef<string | null>(null);
  const selectRef = useRef<(id: string) => void>(() => {});

  const finish = useCallback(() => {
    const swap = swapRef.current;
    swapRef.current = null;
    for (const animation of swap?.animations ?? []) animation.cancel();
    swap?.snapshot.remove();
    if (stageRef.current) {
      stageRef.current.style.visibility = "";
      delete stageRef.current.dataset.switching;
      stageRef.current.querySelector("[data-fur-avatar]")?.dispatchEvent(new CustomEvent("fur-transition", { detail: false }));
    }
    if (galleryRef.current) delete galleryRef.current.dataset.switchDirection;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending && pending !== selectedRef.current) selectRef.current(pending);
  }, []);

  const select = useCallback((target: string) => {
    if (!ids.includes(target)) return;
    if (swapRef.current) { pendingRef.current = target; return; }
    if (target === selectedRef.current) return;
    const stage = stageRef.current, gallery = galleryRef.current;
    const source = stage?.querySelector("canvas");
    const ready = stage?.querySelector('[data-fur-ready="true"]');
    if (stage && gallery && source && ready && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const direction = plushOrbitDirection(ids.indexOf(selectedRef.current), ids.indexOf(target), ids.length);
      const snapshot = document.createElement("div");
      snapshot.className = stage.className;
      snapshot.style.cssText = stage.style.cssText;
      snapshot.setAttribute("aria-hidden", "true");
      snapshot.dataset.plushOutgoing = selectedRef.current;
      snapshot.style.pointerEvents = "none";
      // Keep the old name, theme and zoom with its departing portrait. Cloning
      // only decorative layers avoids duplicating live controls or WebGL roots.
      for (const backdrop of stage.querySelectorAll(":scope > [data-plush-backdrop]")) {
        snapshot.append(backdrop.cloneNode(true));
      }
      const container = document.createElement("div");
      container.className = source.closest('[role="img"]')?.className ?? "";
      const copy = document.createElement("canvas");
      copy.width = source.width;
      copy.height = source.height;
      copy.className = source.className;
      const context = copy.getContext("2d");
      if (ready.getAttribute("data-fur-renderer") === "webgl") {
        ready.dispatchEvent(new CustomEvent("fur-snapshot", { detail: context }));
      } else context?.drawImage(source, 0, 0);
      container.append(copy);
      snapshot.append(container);
      gallery.append(snapshot);
      swapRef.current = { target, direction, snapshot, animations: [], started: false };
      stage.style.visibility = "hidden";
      stage.dataset.switching = "loading";
      gallery.dataset.switchDirection = direction === 1 ? "forward" : "backward";
    }
    selectedRef.current = target;
    setSelected(target);
  }, [ids]);

  useEffect(() => { selectRef.current = select; }, [select]);

  useEffect(() => {
    const gallery = galleryRef.current;
    if (!gallery) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const rendered = (event: Event) => {
      const swap = swapRef.current, stage = stageRef.current;
      if (!swap || !stage || swap.started || !(event.target instanceof HTMLElement) || event.target.dataset.furAvatar !== swap.target) return;
      if (reduced.matches) { finish(); return; }
      swap.started = true;
      stage.style.visibility = "";
      stage.dataset.switching = "moving";
      const width = gallery.clientWidth, height = stage.clientHeight;
      // Both slots turn on the same tilted ring and share its spring clock.
      // Only transforms animate; the departing slot remains a cheap 2D copy.
      const frames: Keyframe[] = [];
      const exitFrames: Keyframe[] = [];
      const transform = (progress: number) => {
        const pose = plushOrbitPose(progress * swap.direction, width, height);
        return `translate3d(${pose.x}px, ${pose.y}px, 0) scale(${pose.scale})`;
      };
      for (let step = 0; step <= 105; step++) {
        const progress = plushSlidePosition(step / 105 * PLUSH_SLIDE_DURATION, width) / width;
        frames.push({ transform: transform(progress), offset: step / 105, easing: "linear" });
        exitFrames.push({ transform: transform(progress - 1), offset: step / 105, easing: "linear" });
      }
      const incoming = stage.animate(frames, { duration: PLUSH_SLIDE_DURATION, fill: "both" });
      const outgoing = swap.snapshot.animate(exitFrames, { duration: PLUSH_SLIDE_DURATION, fill: "both" });
      swap.animations = [incoming, outgoing];
      event.target.dispatchEvent(new CustomEvent("fur-transition", { detail: { animation: incoming, width: gallery.clientWidth, direction: swap.direction } }));
      void incoming.finished.then(() => { if (swapRef.current === swap) finish(); }).catch(() => {});
    };
    const motionChange = () => { if (reduced.matches) finish(); };
    const takeControl = (event: PointerEvent) => {
      if (event.button !== 0 || !swapRef.current?.started || !(event.target instanceof Element) || !event.target.closest("[data-fur-avatar]")) return;
      pendingRef.current = null;
      finish();
    };
    gallery.addEventListener("fur-rendered", rendered);
    gallery.addEventListener("pointerdown", takeControl, true);
    reduced.addEventListener("change", motionChange);
    return () => {
      gallery.removeEventListener("fur-rendered", rendered);
      gallery.removeEventListener("pointerdown", takeControl, true);
      reduced.removeEventListener("change", motionChange);
      pendingRef.current = null;
      const swap = swapRef.current;
      swapRef.current = null;
      for (const animation of swap?.animations ?? []) animation.cancel();
      swap?.snapshot.remove();
    };
  }, [finish]);

  return { selected, select, galleryRef, stageRef };
}
