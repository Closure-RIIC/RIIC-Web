"use client";

// Adapted from React Bits Status Mark. License: ./status-mark.LICENSE.txt
// https://github.com/DavidHDev/react-bits/tree/main/src/ts-default/Micro/StatusMark
import { animate, useMotionValue, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef } from "react";

import "./status-mark.css";

export type StatusMarkStatus = "pending" | "running" | "done" | "failed";

const MORPH = { duration: 0.36, ease: [0.77, 0, 0.175, 1] as [number, number, number, number] };
const SETTLE = { duration: 0.36, ease: [0.23, 1, 0.32, 1] as [number, number, number, number] };
const RADIUS = 9;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const DASH_PITCH = CIRCUMFERENCE / 8;
const IDLE_DASH = 0.3;
const ARC_LENGTH = 0.68;

export function StatusMark({ status, size, active = true }: {
  status: StatusMarkStatus;
  size: number;
  active?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const solid = status !== "pending";
  const running = status === "running";
  const targetArc = running ? ARC_LENGTH : 1;
  const mode = useMotionValue(solid ? 1 : 0);
  const arc = useMotionValue(targetArc);
  const travel = useMotionValue(0);
  const ringRef = useRef<SVGCircleElement>(null);
  const generation = useRef(0);

  useLayoutEffect(() => {
    const writeDash = () => {
      const dash = IDLE_DASH * DASH_PITCH + (arc.get() * CIRCUMFERENCE - IDLE_DASH * DASH_PITCH) * mode.get();
      const gap = (1 - IDLE_DASH) * DASH_PITCH + ((1 - arc.get()) * CIRCUMFERENCE - (1 - IDLE_DASH) * DASH_PITCH) * mode.get();
      ringRef.current?.setAttribute("stroke-dasharray", `${Math.max(0, dash)} ${Math.max(0, gap)}`);
    };
    writeDash();
    ringRef.current?.setAttribute("stroke-dashoffset", String(travel.get()));
    const stopMode = mode.on("change", writeDash);
    const stopArc = arc.on("change", writeDash);
    const stopTravel = travel.on("change", value => ringRef.current?.setAttribute("stroke-dashoffset", String(value)));
    return () => {
      stopMode();
      stopArc();
      stopTravel();
      mode.stop();
      arc.stop();
      travel.stop();
    };
  }, [arc, mode, travel]);

  useEffect(() => {
    const current = ++generation.current;
    if (reduceMotion || !active) {
      mode.jump(solid ? 1 : 0);
      arc.jump(targetArc);
      travel.jump(0);
      return;
    }

    if (mode.get() === 0) arc.jump(targetArc);
    animate(mode, solid ? 1 : 0, MORPH);
    animate(arc, targetArc, SETTLE);
    if (running) {
      const start = travel.get();
      animate(travel, [start, start - CIRCUMFERENCE], { duration: 1.4, ease: "linear", repeat: Infinity });
      return;
    }

    const target = Math.floor(travel.get() / DASH_PITCH) * DASH_PITCH;
    animate(travel, target, SETTLE).then(() => {
      if (generation.current === current) travel.jump(0);
    });
  }, [active, arc, mode, reduceMotion, running, solid, targetArc, travel]);

  return (
    <span className="status-mark" data-status={status} data-live-activity-icon aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" focusable="false">
        <circle className="status-mark__track" cx="12" cy="12" r={RADIUS} transform="rotate(-90 12 12)" />
        <circle ref={ringRef} className="status-mark__ring" cx="12" cy="12" r={RADIUS} transform="rotate(-90 12 12)" />
        <path className="status-mark__check" d="M7.5 12.25 10.5 15.25 16.75 8.75" pathLength="1" />
        <path className="status-mark__cross" d="M8.5 8.5 15.5 15.5M15.5 8.5 8.5 15.5" pathLength="1" />
      </svg>
    </span>
  );
}
