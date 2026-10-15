"use client";

import { useEffect, useRef } from "react";

type Dot = {
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  velocityX: number;
  velocityY: number;
};

const DOT_GAP = 22;
const INFLUENCE_RADIUS = 125;
const DISTORTION = 22;

/** Decorative canvas behind the workbench. It never receives pointer events. */
export function DotDistortionBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    let dots: Dot[] = [];
    let width = 0;
    let height = 0;
    let pointerX = Number.NaN;
    let pointerY = Number.NaN;
    let frame = 0;

    const draw = () => {
      context.clearRect(0, 0, width, height);
      const dark = document.documentElement.classList.contains("dark");
      const interactive = !reducedMotion.matches && finePointer.matches;
      const hasPointer = interactive && Number.isFinite(pointerX);
      const radiusSquared = INFLUENCE_RADIUS * INFLUENCE_RADIUS;
      let unsettled = false;

      context.beginPath();
      for (const dot of dots) {
        let targetX = 0;
        let targetY = 0;
        if (hasPointer) {
          const deltaX = dot.x - pointerX;
          const deltaY = dot.y - pointerY;
          const distanceSquared = deltaX * deltaX + deltaY * deltaY;
          if (distanceSquared < radiusSquared) {
            const distance = Math.sqrt(distanceSquared);
            const strength = (1 - distance / INFLUENCE_RADIUS) ** 2;
            const direction = distance || 1;
            targetX = (deltaX / direction) * strength * DISTORTION;
            targetY = (deltaY / direction) * strength * DISTORTION;
          }
        }

        if (interactive) {
          dot.velocityX = (dot.velocityX + (targetX - dot.offsetX) * 0.11) * 0.78;
          dot.velocityY = (dot.velocityY + (targetY - dot.offsetY) * 0.11) * 0.78;
          dot.offsetX += dot.velocityX;
          dot.offsetY += dot.velocityY;
          unsettled ||= Math.abs(targetX - dot.offsetX) > 0.08
            || Math.abs(targetY - dot.offsetY) > 0.08
            || Math.abs(dot.velocityX) > 0.08
            || Math.abs(dot.velocityY) > 0.08;
        } else {
          dot.offsetX = 0;
          dot.offsetY = 0;
          dot.velocityX = 0;
          dot.velocityY = 0;
        }

        const x = dot.x + dot.offsetX;
        const y = dot.y + dot.offsetY;
        context.moveTo(x + 1.1, y);
        context.arc(x, y, 1.1, 0, Math.PI * 2);
      }
      context.fillStyle = dark ? "rgba(200, 200, 200, 0.2)" : "rgba(53, 75, 100, 0.2)";
      context.fill();

      if (unsettled && !document.hidden) frame = window.requestAnimationFrame(draw);
      else frame = 0;
    };

    const scheduleDraw = () => {
      if (!frame && !document.hidden) frame = window.requestAnimationFrame(draw);
    };

    const rebuild = () => {
      const rect = canvas.getBoundingClientRect();
      const nextWidth = Math.ceil(rect.width);
      const nextHeight = Math.ceil(rect.height);
      if (!nextWidth || !nextHeight || (width === nextWidth && height === nextHeight)) return;
      window.cancelAnimationFrame(frame);
      frame = 0;
      width = nextWidth;
      height = nextHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.ceil(width * ratio);
      canvas.height = Math.ceil(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      dots = [];
      for (let y = DOT_GAP / 2; y < height; y += DOT_GAP) {
        for (let x = DOT_GAP / 2; x < width; x += DOT_GAP) {
          dots.push({ x, y, offsetX: 0, offsetY: 0, velocityX: 0, velocityY: 0 });
        }
      }
      draw();
    };

    const clearPointer = () => {
      if (!Number.isFinite(pointerX)) return;
      pointerX = Number.NaN;
      pointerY = Number.NaN;
      scheduleDraw();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || reducedMotion.matches || !finePointer.matches) return;
      const rect = canvas.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
        clearPointer();
        return;
      }
      pointerX = event.clientX - rect.left;
      pointerY = event.clientY - rect.top;
      scheduleDraw();
    };

    const onPointerOut = (event: PointerEvent) => {
      if (!event.relatedTarget) clearPointer();
    };

    const onPreferenceChange = () => {
      clearPointer();
      scheduleDraw();
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      } else {
        clearPointer();
        scheduleDraw();
      }
    };

    const observer = new ResizeObserver(rebuild);
    const themeObserver = new MutationObserver(scheduleDraw);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    observer.observe(canvas);
    rebuild();
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerout", onPointerOut);
    document.addEventListener("visibilitychange", onVisibilityChange);
    reducedMotion.addEventListener("change", onPreferenceChange);
    finePointer.addEventListener("change", onPreferenceChange);

    return () => {
      observer.disconnect();
      themeObserver.disconnect();
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      reducedMotion.removeEventListener("change", onPreferenceChange);
      finePointer.removeEventListener("change", onPreferenceChange);
    };
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
      <canvas ref={canvasRef} className="sticky top-0 block h-dvh w-full" />
    </div>
  );
}
