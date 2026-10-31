"use client";

import { useEffect, useId, useRef } from "react";

export type GlowCloudProps = {

  background?: boolean;
  animated?: boolean;

  color?: "blue" | "orange";

  followPointer?: boolean;
  className?: string;

  label?: string;
};

const PUFFS = [
  { cx: 115, cy: 93, r: 43 },
  { cx: 163, cy: 111, r: 39 },
  { cx: 156, cy: 155, r: 31 },
  { cx: 107, cy: 155, r: 35 },
  { cx: 72, cy: 126, r: 34 },
];

const CORE = { x: 80, y: 100, width: 80, height: 65 };

const EYES = { y: 106, w: 18, h: 31, left: 96.5, right: 127.5 };
const CX = 120;
const CY = 120;
const BOTTOM = 180;

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
  <stop offset={offset} style={{ stopColor: `var(--ui-gc-${color})`, stopOpacity: opacity }} />
);

export function GlowCloud({
  background = true,
  animated = true,
  color = "blue",
  followPointer = true,
  className,
  label = "A glowing cloud with eyes that floats, looks around and blinks",
}: GlowCloudProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const id = (name: string) => `gc${uid}-${name}`;

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

  const puffs = PUFFS.map((puff, index) => <circle key={index} {...puff} />);
  const eye = (positionX: number, ref: typeof leftEye, side: string) => {
    const pill = { x: positionX, y: EYES.y, width: EYES.w, height: EYES.h, rx: EYES.w / 2 };
    return (
      <g ref={ref}>
        <rect {...pill} fill={`url(#${id("eye")})`} />

        <clipPath id={id(`clip-${side}`)}>
          <rect {...pill} />
        </clipPath>
        <rect {...pill} y={EYES.y + 2.5} className="ui-gc__eye-shade" fill="none" strokeWidth="5" filter={`url(#${id("edge")})`} clipPath={`url(#${id(`clip-${side}`)})`} />
      </g>
    );
  };

  return (
    <div
      ref={root}
      className={["ui-gc", className].filter(Boolean).join(" ")}
      data-bg={background || undefined}
      data-color={color}
      role="img"
      aria-label={label}
    >

      <style href="ui-glow-cloud" precedence="default">
        {css}
      </style>
      <svg viewBox="0 0 240 240" aria-hidden="true">
        <defs>

          <filter id={id("goo")} x="0" y="0" width="240" height="240" filterUnits="userSpaceOnUse">
            <feGaussianBlur stdDeviation="3.5" />
            <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 28 -12" />
          </filter>
          <filter id={id("soft")} x="0" y="0" width="240" height="240" filterUnits="userSpaceOnUse">
            <feGaussianBlur stdDeviation="7" />
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
          <g id={id("shape")} filter={`url(#${id("goo")})`}>
            {puffs}
            <rect {...CORE} />
          </g>
          <mask id={id("mask")} maskUnits="userSpaceOnUse" x="0" y="0" width="240" height="240">
            <use href={`#${id("shape")}`} fill="#fff" />
          </mask>
          <linearGradient id={id("rim")} x1="0" y1="56" x2="0" y2="182" gradientUnits="userSpaceOnUse">
            <Stop offset={0} color="rim" />
            <Stop offset={1} color="white" />
          </linearGradient>
          <radialGradient id={id("body")} cx="120" cy="108" r="78" gradientUnits="userSpaceOnUse">
            <Stop offset={0} color="body-1" />
            <Stop offset={0.6} color="body-2" />
            <Stop offset={1} color="body-3" />
          </radialGradient>
          <linearGradient id={id("eye")} x1="0" y1="0" x2="0" y2="1">
            <Stop offset={0} color="white" />
            <Stop offset={1} color="eye" />
          </linearGradient>
        </defs>

        <ellipse ref={shadowRef} className="ui-gc__shadow" cx={CX} cy="210" rx="54" ry="7" filter={`url(#${id("shade")})`} />

        <g ref={floatRef}>
          <g ref={turnRef}>

            <use href={`#${id("shape")}`} className="ui-gc__halo" filter={`url(#${id("halo")})`} />
            <use href={`#${id("shape")}`} className="ui-gc__edge" filter={`url(#${id("edge")})`} />
            <g mask={`url(#${id("mask")})`}>
              <rect width="240" height="240" fill={`url(#${id("rim")})`} />

              <g filter={`url(#${id("soft")})`} fill={`url(#${id("body")})`} transform={`translate(0 2) ${about(CX, CY, "scale(0.9 0.87)")}`}>
                {puffs}
                <rect {...CORE} />
              </g>
              <ellipse ref={shineRef} cx="104" cy="80" rx="30" ry="12" fill="#fff" opacity="0.32" filter={`url(#${id("shade")})`} />
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

.ui-gc {
  --ui-gc-sky-top: #2475ea;
  --ui-gc-sky-bottom: #4ac8f5;
  --ui-gc-sky-light: rgba(110, 225, 255, 0.55);
  --ui-gc-white: #ffffff;
  --ui-gc-rim: #f4fcff;
  --ui-gc-body-1: #06a3ff;
  --ui-gc-body-2: #18b2ff;
  --ui-gc-body-3: #58cdff;
  --ui-gc-eye: #cdeeff;
  --ui-gc-eye-shade: rgba(30, 140, 230, 0.3);
  --ui-gc-halo: rgba(30, 150, 255, 0.2);
  --ui-gc-edge: rgba(20, 120, 240, 0.4);
  --ui-gc-shadow: rgba(10, 90, 200, 0.55);
  --ui-gc-ground: rgba(10, 80, 190, 0.4);
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
.ui-gc[data-color="orange"] {
  --ui-gc-sky-top: #e94135;
  --ui-gc-sky-bottom: #fa9842;
  --ui-gc-sky-light: rgba(255, 205, 150, 0.5);
  --ui-gc-rim: #fff9f5;
  --ui-gc-body-1: #f45434;
  --ui-gc-body-2: #fa7342;
  --ui-gc-body-3: #ffb175;
  --ui-gc-eye: #ffe8db;
  --ui-gc-eye-shade: rgba(230, 90, 50, 0.3);
  --ui-gc-halo: rgba(240, 100, 60, 0.2);
  --ui-gc-edge: rgba(220, 80, 40, 0.4);
  --ui-gc-shadow: rgba(170, 50, 20, 0.5);
  --ui-gc-ground: rgba(150, 30, 10, 0.36);
}
.ui-gc svg { display: block; width: 100%; max-width: 320px; overflow: visible; }
.ui-gc__halo { fill: var(--ui-gc-halo); }
.ui-gc__edge { fill: var(--ui-gc-edge); }
.ui-gc__shadow { fill: var(--ui-gc-shadow); }
.ui-gc__eye-shade { stroke: var(--ui-gc-eye-shade); }

.ui-gc[data-bg] {
  --ui-gc-halo: rgba(255, 255, 255, 0.55);
  --ui-gc-edge: rgba(255, 255, 255, 0.3);
  --ui-gc-shadow: var(--ui-gc-ground);
  background:
    radial-gradient(60% 55% at 62% 42%, var(--ui-gc-sky-light), transparent 70%),
    linear-gradient(180deg, var(--ui-gc-sky-top), var(--ui-gc-sky-bottom));
}

:where(.dark, [data-theme="dark"]) .ui-gc {
  --ui-gc-sky-top: #1659c8;
  --ui-gc-sky-bottom: #2aa6e6;
  --ui-gc-sky-light: rgba(90, 205, 255, 0.45);
  --ui-gc-ground: rgba(5, 50, 140, 0.5);
}
:where(.dark, [data-theme="dark"]) .ui-gc[data-color="orange"] {
  --ui-gc-sky-top: #bf2722;
  --ui-gc-sky-bottom: #ed701d;
  --ui-gc-sky-light: rgba(255, 175, 120, 0.42);
  --ui-gc-ground: rgba(110, 15, 5, 0.5);
}
:where(.dark, [data-theme="dark"]) .ui-gc:not([data-bg]) {
  --ui-gc-halo: rgba(255, 255, 255, 0.35);
  --ui-gc-edge: rgba(255, 255, 255, 0.25);
}
`;
