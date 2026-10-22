"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { createContext, Suspense, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Timing and crossfade follow https://www.interior.dev/docs/skeleton-swap.
// Keep each caller's placeholder geometry; page-sized regions remain in normal
// document flow instead of becoming fixed-height nested scroll containers.
const CROSSFADE = { type: "spring", stiffness: 260, damping: 34, mass: 0.8 } as const;

export function SkeletonSwap({ ready, skeleton, children, className, reserve, delay = 120, minVisible = 380 }: {
  ready: boolean;
  skeleton: ReactNode;
  children: ReactNode;
  className?: string;
  reserve?: number;
  delay?: number;
  minVisible?: number;
}) {
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);
  useEffect(() => {
    if (!ready) {
      if (visible) return;
      const timer = window.setTimeout(() => {
        shownAt.current = performance.now();
        setVisible(true);
      }, delay);
      return () => window.clearTimeout(timer);
    }
    if (!visible) return;
    const timer = window.setTimeout(() => setVisible(false), Math.max(0, minVisible - (performance.now() - shownAt.current)));
    return () => window.clearTimeout(timer);
  }, [ready, visible, delay, minVisible]);
  const covered = !ready || visible;
  const transition = reduced ? { duration: 0 } : CROSSFADE;
  return <div className={cn("relative grid min-w-0", className)} style={{ minHeight: reserve }} aria-busy={!ready} data-skeleton-swap={covered ? "loading" : "ready"}>
    <motion.div
      className="col-start-1 row-start-1 min-w-0"
      data-skeleton-swap-content
      initial={false}
      animate={{ opacity: covered ? 0 : 1, scale: reduced || !covered ? 1 : 0.99, filter: reduced || !covered ? "blur(0px)" : "blur(4px)", transitionEnd: covered ? undefined : { filter: "none" } }}
      transition={transition}
      style={{ transformOrigin: "top left", pointerEvents: covered ? "none" : undefined }}
      inert={covered}
      aria-hidden={covered || undefined}
    >{children}</motion.div>
    <AnimatePresence initial={false}>
      {covered ? <motion.div
        key="skeleton"
        className="pointer-events-none col-start-1 row-start-1 min-w-0 self-start"
        data-skeleton-swap-placeholder
        aria-hidden="true"
        initial={false}
        animate={{ opacity: visible ? 1 : 0, filter: "blur(0px)" }}
        exit={{ opacity: 0, filter: reduced ? "blur(0px)" : "blur(3px)" }}
        transition={transition}
      >{skeleton}</motion.div> : null}
    </AnimatePresence>
  </div>;
}

function SuspenseState({ pending, onChange, children }: { pending: boolean; onChange: (pending: boolean) => void; children?: ReactNode }) {
  useLayoutEffect(() => { onChange(pending); }, [onChange, pending]);
  return children;
}

/** A stable crossfade around lazy components that render in the document flow. */
export function SkeletonSuspense({ fallback, children, className }: { fallback: ReactNode; children: ReactNode; className?: string }) {
  const [pending, setPending] = useState(true);
  return <SkeletonSwap ready={!pending} skeleton={fallback} className={className}>
    <Suspense fallback={<SuspenseState pending onChange={setPending} />}>
      <SuspenseState pending={false} onChange={setPending}>{children}</SuspenseState>
    </Suspense>
  </SkeletonSwap>;
}

type RegisterFallback = (fallback: ReactNode) => () => void;
const RouteFallbackContext = createContext<RegisterFallback | null>(null);

/** Lets Next's loading.tsx hand its placeholder to the persistent route shell. */
export function SkeletonRouteBoundary({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ pending: boolean; fallback: ReactNode; owner?: symbol }>({ pending: false, fallback: null });
  const register = useCallback<RegisterFallback>(fallback => {
    const owner = Symbol();
    setState({ pending: true, fallback, owner });
    return () => setState(current => current.owner === owner ? { ...current, pending: false } : current);
  }, []);
  return <RouteFallbackContext.Provider value={register}>
    <SkeletonSwap ready={!state.pending} skeleton={state.fallback}>{children}</SkeletonSwap>
  </RouteFallbackContext.Provider>;
}

export function SkeletonRouteFallback({ children }: { children: ReactNode }) {
  const register = useContext(RouteFallbackContext);
  useLayoutEffect(() => register?.(children), [children, register]);
  // The persistent boundary owns this placeholder while registered. Rendering
  // it here as well duplicates page landmarks during the crossfade.
  return register ? null : children;
}
