"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";

import { MOTION_DURATION, MOTION_EASE_OUT } from "@/motion";
import { SkeletonRouteBoundary } from "@/components/ui/skeleton-swap";

export function PrimaryPageTransition({
  pageKey,
  children,
}: {
  pageKey: string;
  children: ReactNode;
}) {
  const shouldReduceMotion = useReducedMotion();
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => {
    setHasMounted(true);
  }, []);

  return (
    <motion.div
      key={pageKey}
      initial={hasMounted ? { opacity: 0, y: shouldReduceMotion ? 0 : 4 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: shouldReduceMotion ? MOTION_DURATION.feedback : MOTION_DURATION.fast, ease: MOTION_EASE_OUT }}
      data-primary-page={pageKey}
    >
      <SkeletonRouteBoundary>{children}</SkeletonRouteBoundary>
    </motion.div>
  );
}
