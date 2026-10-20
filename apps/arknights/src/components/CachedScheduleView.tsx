"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Keep a view mounted in its own container, detached while it is inactive. */
export function CachedScheduleView({ active, mode, children }: {
  active: boolean;
  mode: "list" | "compact";
  children: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  // This component mounts only after ScheduleBoard has selected a client layout.
  const [container] = useState(() => {
    const element = document.createElement("div");
    element.dataset.scheduleView = mode;
    element.dataset.scheduleViewTransition = mode === "compact" ? "skeleton" : "rooms";
    return element;
  });

  useLayoutEffect(() => {
    if (active) host.current?.appendChild(container);
    return () => { container.remove(); };
  }, [active, container]);

  return (
    <>
      <div
        ref={host}
        hidden={!active}
      />
      {createPortal(children, container)}
    </>
  );
}
