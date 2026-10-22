import { memo, useEffect, useRef } from "react";
import artwork from "./dijiang-artwork.svg?raw";
import motion from "./dijiang-motion.json";
import { TURN } from "./dijiang-turn.mjs";
import "./dijiang-turn.css";
import "./dijiang-backdrop.css";

/** Decorative only: the result cards remain the source of all game data. */
export const DijiangBackdrop = memo(function DijiangBackdrop() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const controller = TURN.mount(element, motion);
    const vessel = element.querySelector<HTMLElement>(".ef-dijiang-vessel");
    const svg = element.querySelector<SVGSVGElement>("[data-dijiang-artwork]");
    const fit = () => {
      if (!vessel || !svg) return;
      const width = element.clientWidth, height = element.clientHeight;
      if (!width || !height) return;
      const bounds = svg.getBBox();
      const view = svg.viewBox.baseVal;
      const unit = Math.min(width / view.width, height / view.height);
      const shift = width * .075;
      const left = (bounds.x - view.width / 2) * unit;
      const right = (bounds.x + bounds.width - view.width / 2) * unit;
      const padding = 10;
      // Prefer the large illustration, but keep both ends inside the board.
      // Measure only on resize; rotating the enclosed core cannot change these
      // outer hull bounds. This never runs in the animation loop.
      const scale = Math.max(.1, Math.min(1.3,
        (width / 2 - padding - shift) / Math.max(1, right),
        (width / 2 - padding + shift) / Math.max(1, -left)));
      vessel.style.transform = `translateX(${shift}px) scale(${scale})`;
    };
    fit();
    const resize = new ResizeObserver(fit);
    resize.observe(element);
    let visible = false;
    let frame = 0;
    let last = 0;
    let angle = 0;
    let running = false;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const draw = (time: number) => {
      if (!running) return;
      // Thirty frames per second is sufficient for this slow background motion.
      // Time-based rotation stays smooth without re-rendering React/result cards.
      if (!last) last = time;
      const elapsed = time - last;
      if (elapsed >= 1000 / 30) {
        angle = (angle + Math.min(elapsed, 100) * .018) % 360;
        last = time;
        controller.set({ protorig: angle });
      }
      frame = requestAnimationFrame(draw);
    };
    const update = () => {
      const next = visible && !document.hidden && !reducedMotion.matches;
      element.dataset.running = String(next);
      if (next === running) return;
      running = next;
      cancelAnimationFrame(frame);
      last = 0;
      if (running) frame = requestAnimationFrame(draw);
    };
    const observer = new IntersectionObserver(entries => {
      visible = entries[entries.length - 1]?.isIntersecting ?? false;
      update();
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", update);
    reducedMotion.addEventListener("change", update);
    return () => {
      running = false;
      cancelAnimationFrame(frame);
      controller.destroy();
      resize.disconnect();
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
      reducedMotion.removeEventListener("change", update);
    };
  }, []);
  // Only checked-in, generated SVG is inserted; no account or network data.
  return <div ref={ref} className="ef-dijiang" aria-hidden="true" data-running="false">
    <div className="ef-dijiang-vessel" dangerouslySetInnerHTML={{ __html: artwork }} />
  </div>;
});
