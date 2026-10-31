"use client";

import { useEffect, useId, useRef } from "react";

export type FrostCloudProps = {

  background?: boolean;
  animated?: boolean;

  color?: "blue" | "orange" | "closure";

  followPointer?: boolean;
  className?: string;

  label?: string;
};

const EYES = { y: 104.5, w: 20, h: 34, left: 93.5, right: 128.5 };
const CX = 120;
const CY = 120;
const RADIUS = 72;
const BOTTOM = CY + RADIUS;

const FROST_GRADIENT_STOPS = Array.from({ length: 33 }, (_unused, index) => {
  const offset = index / 32;
  const radiusSquared = offset * offset;
  const fade = radiusSquared * radiusSquared * (3 - 2 * radiusSquared);
  return { offset, opacity: 0.02 + 0.88 * (1 - fade) };
});

const GLANCES = [
  { x: 0, y: 0 },
  { x: -1, y: 0.05 },
  { x: 1, y: -0.05 },
  { x: 0, y: 0 },
  { x: 0.65, y: -0.55 },
  { x: -0.7, y: 0.35 },
];

const about = (originX: number, originY: number, transform: string) => `translate(${originX} ${originY}) ${transform} translate(${-originX} ${-originY})`;

const Stop = ({ offset, color, opacity }: { offset: number; color: string; opacity?: number }) => (
  <stop offset={offset} style={{ stopColor: `var(--ui-fc-${color})`, stopOpacity: opacity }} />
);

export function FrostCloud({
  background = true,
  animated = true,
  color = "closure",
  followPointer = true,
  className,
  label = "A round Closure vinyl mascot that floats, looks around and blinks",
}: FrostCloudProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const id = (name: string) => `fc${uid}-${name}`;

  const root = useRef<HTMLDivElement>(null);
  const floatRef = useRef<SVGGElement>(null);
  const turnRef = useRef<SVGGElement>(null);
  const eyesRef = useRef<SVGGElement>(null);
  const leftEye = useRef<SVGGElement>(null);
  const rightEye = useRef<SVGGElement>(null);
  const shineRef = useRef<SVGEllipseElement>(null);
  const shadowRef = useRef<SVGEllipseElement>(null);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let still = !animated || media.matches;
    let visible = false;
    element.dataset.motion = still ? "paused" : "running";

    const look = { x: 0, y: 0, vx: 0, vy: 0 };
    const target = { x: 0, y: 0 };
    const squish = { p: 0, v: 0 };
    let pointer = false;
    let nextGlance = 1.2;
    let nextBlink = 1.8;
    let blinkAt = -1;
    let blinkTwice = false;
    let winkAt = -1;
    let frame = 0;
    let last = 0;
    let time = 0;

    const blinkScale = (since: number, length = 0.16) => (since < 0 || since > length ? 1 : 1 - 0.9 * Math.sin((since / length) * Math.PI));

    const draw = () => {
      const float = still ? 0 : Math.sin(time * 1.1) * 5;
      const breathe = still ? 0 : Math.sin(time * 1.1 + Math.PI / 2) * 0.012;
      const sy = 1 + breathe - squish.p * 0.12;
      const sx = 1 - breathe + squish.p * 0.1;
      floatRef.current?.setAttribute("transform", `translate(0 ${float.toFixed(2)}) ${about(CX, BOTTOM, `scale(${sx.toFixed(4)} ${sy.toFixed(4)})`)}`);

      turnRef.current?.setAttribute("transform", `translate(${(look.x * 4).toFixed(2)} ${(look.y * 2).toFixed(2)}) ${about(CX, CY, `rotate(${(look.x * 2.5).toFixed(2)}) scale(${(1 - Math.abs(look.x) * 0.025).toFixed(4)} 1)`)}`);
      eyesRef.current?.setAttribute("transform", `translate(${(look.x * 12).toFixed(2)} ${(look.y * 7).toFixed(2)})`);
      shineRef.current?.setAttribute("transform", `translate(${(-look.x * 7).toFixed(2)} ${(-look.y * 3).toFixed(2)})`);
      const both = blinkAt < 0 ? 1 : Math.min(blinkScale(time - blinkAt), blinkTwice ? blinkScale(time - blinkAt - 0.26) : 1);
      const wink = blinkScale(time - winkAt, 0.34);
      const eyeY = EYES.y + EYES.h / 2;
      leftEye.current?.setAttribute("transform", about(EYES.left + EYES.w / 2, eyeY, `scale(1 ${both.toFixed(3)})`));
      rightEye.current?.setAttribute("transform", about(EYES.right + EYES.w / 2, eyeY, `scale(1 ${Math.min(both, wink).toFixed(3)})`));

      const lift = (float + 5) / 10;
      shadowRef.current?.setAttribute("transform", about(CX, 210, `scale(${(1 - lift * 0.12).toFixed(3)} 1)`));
      shadowRef.current?.setAttribute("opacity", (0.34 - lift * 0.1).toFixed(3));
    };

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - (last || now)) / 1000);
      last = now;
      time += dt;

      if (!pointer && time > nextGlance) {
        const glance = GLANCES[Math.floor(Math.random() * GLANCES.length)];
        target.x = glance.x;
        target.y = glance.y;
        nextGlance = time + 1.4 + Math.random() * 2.2;
      }
      if (time > nextBlink) {
        blinkAt = time;
        blinkTwice = Math.random() < 0.25;
        nextBlink = time + 2.4 + Math.random() * 3;
      }

      look.vx += ((target.x - look.x) * 70 - look.vx * 13) * dt;
      look.vy += ((target.y - look.y) * 70 - look.vy * 13) * dt;
      look.x += look.vx * dt;
      look.y += look.vy * dt;
      squish.v += (-squish.p * 220 - squish.v * 9) * dt;
      squish.p += squish.v * dt;

      draw();
      frame = requestAnimationFrame(tick);
    };

    const start = () => {
      if (frame || still) return;
      last = 0;
      frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };

    const updatePlayback = () => {
      if (visible && !document.hidden && !still) start();
      else stop();
    };
    const onMotionChange = () => {
      still = !animated || media.matches;
      element.dataset.motion = still ? "paused" : "running";
      draw();
      updatePlayback();
    };
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      updatePlayback();
    });
    media.addEventListener("change", onMotionChange);
    document.addEventListener("visibilitychange", updatePlayback);
    io.observe(element);

    const onMove = (event: PointerEvent) => {
      if (!followPointer || still) return;
      const bounds = element.getBoundingClientRect();
      pointer = true;
      target.x = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width - 0.5) * 2.4));
      target.y = Math.max(-1, Math.min(1, ((event.clientY - bounds.top) / bounds.height - 0.5) * 2.4));
    };
    const onLeave = () => {
      pointer = false;
      target.x = 0;
      target.y = 0;
      nextGlance = time + 1.2;
    };
    const onDown = () => {
      if (still) return;
      squish.p = 0.9;
      squish.v = 0;
      winkAt = time + 0.12;
    };
    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerleave", onLeave);
    element.addEventListener("pointerdown", onDown);
    draw();

    return () => {
      stop();
      io.disconnect();
      media.removeEventListener("change", onMotionChange);
      document.removeEventListener("visibilitychange", updatePlayback);
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerleave", onLeave);
      element.removeEventListener("pointerdown", onDown);
    };
  }, [animated, followPointer]);

  const eye = (positionX: number, ref: typeof leftEye, side: string) => {
    const pill = { x: positionX, y: EYES.y, width: EYES.w, height: EYES.h, rx: EYES.w / 2 };
    return (
      <g ref={ref}>

        <rect {...pill} x={positionX - 1.5} y={EYES.y - 1} width={EYES.w + 3} height={EYES.h + 3} rx={EYES.w / 2 + 1.5} className="ui-fc__eye-drop" filter={`url(#${id("edge")})`} />
        <rect {...pill} fill={`url(#${id("hole")})`} />
        <clipPath id={id(`clip-${side}`)}>
          <rect {...pill} />
        </clipPath>
        <rect {...pill} y={EYES.y + 2.5} className="ui-fc__eye-shade" fill="none" strokeWidth="5" filter={`url(#${id("edge")})`} clipPath={`url(#${id(`clip-${side}`)})`} />
      </g>
    );
  };

  return (
    <div
      ref={root}
      className={["ui-fc", className].filter(Boolean).join(" ")}
      data-bg={background || undefined}
      data-color={color}
      role="img"
      aria-label={label}
    >

      <style href="ui-frost-cloud" precedence="default">
        {css}
      </style>
      <svg viewBox="0 0 240 240" aria-hidden="true">
        <defs>

          <filter id={id("soft")} x="0" y="0" width="240" height="240" filterUnits="userSpaceOnUse">
            <feGaussianBlur stdDeviation="12" />
          </filter>
          <filter id={id("halo")} x="0" y="0" width="240" height="240" filterUnits="userSpaceOnUse">
            <feGaussianBlur stdDeviation="9" />
          </filter>
          <filter id={id("edge")} x="0" y="0" width="240" height="240" filterUnits="userSpaceOnUse">
            <feGaussianBlur stdDeviation="1.6" />
          </filter>
          <filter id={id("shade")} x="0" y="0" width="240" height="240" filterUnits="userSpaceOnUse">
            <feGaussianBlur stdDeviation="5" />
          </filter>
          <circle id={id("shape")} cx={CX} cy={CY} r={RADIUS} />
          <mask id={id("mask")} maskUnits="userSpaceOnUse" x="0" y="0" width="240" height="240">
            <use href={`#${id("shape")}`} fill="#fff" />
          </mask>
          {color === "closure" ? <radialGradient id={id("frost")} cx={CX} cy={CY} r={RADIUS} gradientUnits="userSpaceOnUse">
            {FROST_GRADIENT_STOPS.map(({ offset, opacity }) => <Stop key={offset} offset={offset} color="frost" opacity={opacity} />)}
          </radialGradient> : <linearGradient id={id("frost")} x1="0" y1="50" x2="0" y2="192" gradientUnits="userSpaceOnUse">
            <Stop offset={0} color="white" />
            <Stop offset={1} color="frost" opacity={0.97} />
          </linearGradient>}
          <linearGradient id={id("hole")} x1="0" y1="0" x2="0" y2="1">
            <Stop offset={0} color="hole-1" />
            <Stop offset={1} color="hole-2" />
          </linearGradient>
        </defs>

        <ellipse ref={shadowRef} className="ui-fc__shadow" cx={CX} cy="210" rx="54" ry="7" filter={`url(#${id("shade")})`} />

        <g ref={floatRef}>
          <g ref={turnRef}>

            <use href={`#${id("shape")}`} className="ui-fc__halo" filter={`url(#${id("halo")})`} />
            <use href={`#${id("shape")}`} className="ui-fc__edge" filter={`url(#${id("edge")})`} />
            <g mask={`url(#${id("mask")})`}>
              <rect width="240" height="240" fill={`url(#${id("frost")})`} />

              <g filter={`url(#${id("soft")})`} className="ui-fc__tint" transform={`translate(-6 18) ${about(CX, CY, "scale(0.84 0.78)")}`}>
                <use href={`#${id("shape")}`} />
              </g>
              <ellipse ref={shineRef} cx="108" cy="78" rx="34" ry="14" fill="#fff" opacity={color === "closure" ? 0.1 : 0.75} filter={`url(#${id("shade")})`} />
            </g>
            <g ref={eyesRef}>
              {eye(EYES.left, leftEye, "l")}
              {eye(EYES.right, rightEye, "r")}
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}

const css = `

.ui-fc {
  --ui-fc-sky-top: #2475ea;
  --ui-fc-sky-bottom: #4ac8f5;
  --ui-fc-sky-light: rgba(110, 225, 255, 0.55);
  --ui-fc-white: #ffffff;
  --ui-fc-frost: #eef8ff;
  --ui-fc-tint: rgba(70, 165, 235, 0.2);
  --ui-fc-hole-1: #3aaef2;
  --ui-fc-hole-2: #62cdfa;
  --ui-fc-eye-drop: rgba(40, 130, 210, 0.1);
  --ui-fc-eye-shade: rgba(10, 90, 190, 0.24);
  --ui-fc-halo: rgba(30, 150, 255, 0.2);
  --ui-fc-edge: rgba(20, 120, 240, 0.4);
  --ui-fc-shadow: rgba(10, 90, 200, 0.55);
  --ui-fc-ground: rgba(10, 80, 190, 0.4);
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  aspect-ratio: 1;
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}
.ui-fc[data-color="orange"] {
  --ui-fc-sky-top: #e94135;
  --ui-fc-sky-bottom: #fa9842;
  --ui-fc-sky-light: rgba(255, 205, 150, 0.5);
  --ui-fc-frost: #fff5f0;
  --ui-fc-tint: rgba(235, 110, 70, 0.2);
  --ui-fc-hole-1: #f05f42;
  --ui-fc-hole-2: #fba05b;
  --ui-fc-eye-drop: rgba(200, 70, 40, 0.1);
  --ui-fc-eye-shade: rgba(170, 40, 20, 0.24);
  --ui-fc-halo: rgba(240, 100, 60, 0.2);
  --ui-fc-edge: rgba(220, 80, 40, 0.4);
  --ui-fc-shadow: rgba(170, 50, 20, 0.5);
  --ui-fc-ground: rgba(150, 30, 10, 0.36);
}
.ui-fc[data-color="closure"] {
  --ui-fc-sky-top: #17212b;
  --ui-fc-sky-bottom: #3d4a57;
  --ui-fc-sky-light: rgba(111, 131, 149, 0.35);
  --ui-fc-frost: #17212b;
  --ui-fc-tint: rgba(10, 18, 27, 0.03);
  --ui-fc-hole-1: #f26478;
  --ui-fc-hole-2: #b32b47;
  --ui-fc-eye-drop: rgba(72, 7, 23, 0.3);
  --ui-fc-eye-shade: rgba(46, 4, 14, 0.22);
  --ui-fc-halo: rgba(57, 73, 89, 0.025);
  --ui-fc-edge: rgba(123, 141, 158, 0.035);
  --ui-fc-shadow: rgba(11, 17, 25, 0.28);
  --ui-fc-ground: rgba(11, 17, 25, 0.4);
}
.ui-fc svg { display: block; width: 100%; max-width: 320px; overflow: visible; }
.ui-fc__halo { fill: var(--ui-fc-halo); }
.ui-fc__edge { fill: var(--ui-fc-edge); }
.ui-fc__shadow { fill: var(--ui-fc-shadow); }
.ui-fc__tint { fill: var(--ui-fc-tint); }
.ui-fc__eye-drop { fill: var(--ui-fc-eye-drop); }
.ui-fc__eye-shade { stroke: var(--ui-fc-eye-shade); }

.ui-fc[data-bg] {
  --ui-fc-halo: rgba(255, 255, 255, 0.75);
  --ui-fc-edge: rgba(255, 255, 255, 0.5);
  --ui-fc-shadow: var(--ui-fc-ground);
  background:
    radial-gradient(60% 55% at 62% 42%, var(--ui-fc-sky-light), transparent 70%),
    linear-gradient(180deg, var(--ui-fc-sky-top), var(--ui-fc-sky-bottom));
}

:where(.dark, [data-theme="dark"]) .ui-fc {
  --ui-fc-sky-top: #1659c8;
  --ui-fc-sky-bottom: #2aa6e6;
  --ui-fc-sky-light: rgba(90, 205, 255, 0.45);
  --ui-fc-ground: rgba(5, 50, 140, 0.5);
}
:where(.dark, [data-theme="dark"]) .ui-fc[data-color="orange"] {
  --ui-fc-sky-top: #bf2722;
  --ui-fc-sky-bottom: #ed701d;
  --ui-fc-sky-light: rgba(255, 175, 120, 0.42);
  --ui-fc-ground: rgba(110, 15, 5, 0.5);
}
:where(.dark, [data-theme="dark"]) .ui-fc:not([data-bg]) {
  --ui-fc-halo: rgba(255, 255, 255, 0.35);
  --ui-fc-edge: rgba(255, 255, 255, 0.25);
}
:where(.dark, [data-theme="dark"]) .ui-fc[data-color="closure"]:not([data-bg]) {
  --ui-fc-halo: rgba(255, 255, 255, 0.025);
  --ui-fc-edge: rgba(255, 255, 255, 0.04);
}
`;
