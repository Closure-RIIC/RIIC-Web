"use client";
import { useTranslations } from "use-intl";

import { ArrowUp } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

import { cn } from "@/lib/utils";

export function HelpBackToTop() {
  const intl = useTranslations();

  const reduceMotion = useReducedMotion();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let animationFrame: number | null = null;

    const updateVisibility = () => {
      if (animationFrame !== null) return;

      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        setVisible(window.scrollY >= window.innerHeight);
      });
    };

    updateVisibility();
    window.addEventListener("scroll", updateVisibility, { passive: true });
    window.addEventListener("resize", updateVisibility);

    return () => {
      window.removeEventListener("scroll", updateVisibility);
      window.removeEventListener("resize", updateVisibility);
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
    };
  }, []);

  function scrollToTop() {
    document.getElementById("help-content")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  }

  return (
    <Button
      aria-hidden={!visible}
      aria-label={intl("components_help_HelpBackToTop.backToTop")}
      className={cn(
        "fixed z-40 size-12 rounded-full border-border bg-background/95 text-foreground shadow-xl shadow-foreground/15 ring-4 ring-background/75 backdrop-blur-sm transition-[opacity,transform,background-color,border-color,box-shadow] duration-200 hover:bg-muted motion-reduce:transform-none motion-reduce:transition-none print:hidden",
        visible
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-2 opacity-0",
      )}
      data-help-back-to-top
      onClick={scrollToTop}
      size="icon"
      style={{
        bottom: "calc(max(1rem, env(safe-area-inset-bottom)) + 3.75rem)",
        right: "max(1rem, env(safe-area-inset-right))",
      }}
      tabIndex={visible ? 0 : -1}
      type="button"
      variant="outline"
    >
      <ArrowUp className="size-5" aria-hidden="true" />
    </Button>
  );
}
