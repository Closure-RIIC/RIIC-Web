"use client";
import { useTranslations } from "next-intl";

/*
 * Drawer interaction adapted from interior.dev by Dominic Doemann.
 * Source: https://github.com/ddoemonn/interior/blob/main/components/interior/drawer.tsx
 * Licensed under the MIT License: https://github.com/ddoemonn/interior/blob/main/LICENSE
 */

import { animate, motion, type PanInfo, useDragControls, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { XIcon } from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { dialogAccentForPathname } from "@/workbench-accent";

const DRAWER_SPRING = { type: "spring", stiffness: 150, damping: 27, mass: 1 } as const;
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
type Inertable = HTMLElement & { inert?: boolean };

export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  width = 560,
  className,
  onCloseComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  width?: number;
  className?: string;
  onCloseComplete?: () => void;
}) {
  const intl = useTranslations();
  const pathname = usePathname();
  const titleId = useId();
  const hintId = useId();
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(open);
  const [dragging, setDragging] = useState(false);
  const reducedMotion = useReducedMotion();

  const controls = useDragControls();
  const shellRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const closePendingRef = useRef(false);
  const onCloseCompleteRef = useRef(onCloseComplete);
  const dragStartClientXRef = useRef<number | null>(null);
  const dragMaxOffsetXRef = useRef(0);
  const animationRef = useRef<{ stop: () => void } | null>(null);
  const away = width + 24;
  const x = useMotionValue(open ? 0 : away);
  const veil = useTransform(x, (value) => 1 - Math.min(1, Math.abs(value) / width));

  const glide = useCallback((target: number) => {
    animationRef.current?.stop();
    animationRef.current = animate(x, target, reducedMotion ? { duration: 0 } : DRAWER_SPRING);
  }, [reducedMotion, x]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  useEffect(() => setHost(document.body), []);
  useEffect(() => {
    onCloseCompleteRef.current = onCloseComplete;
  }, [onCloseComplete]);
  useEffect(() => {
    if (open && !mounted) {
      x.set(away);
      setMounted(true);
      return;
    }
    if (!mounted) return;
    glide(open ? 0 : away);
    if (!open) {
      closePendingRef.current = true;
      const closingAnimation = animationRef.current;
      void Promise.resolve(closingAnimation).then(() => {
        if (animationRef.current === closingAnimation) setMounted(false);
      });
    }
    return () => animationRef.current?.stop();
  }, [away, glide, mounted, open, x]);

  useEffect(() => {
    const panel = panelRef.current as Inertable | null;
    if (!panel) return;
    panel.inert = !mounted;
    return () => { panel.inert = false; };
  }, [mounted]);

  useEffect(() => {
    if (open) {
      const active = document.activeElement;
      returnFocusRef.current = active instanceof HTMLElement ? active : null;
      const panel = panelRef.current;
      const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panel)?.focus({ preventScroll: true });
      return;
    }
    if (!mounted) {
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      if (target?.isConnected) target.focus({ preventScroll: true });
      if (closePendingRef.current) {
        closePendingRef.current = false;
        onCloseCompleteRef.current?.();
      }
    }
  }, [mounted, open]);

  useEffect(() => {
    if (!mounted) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [close, mounted]);

  useEffect(() => {
    if (!mounted) return;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    const previousPadding = root.style.paddingRight;
    const gutter = window.innerWidth - root.clientWidth;
    root.style.overflow = "hidden";
    if (gutter > 0) root.style.paddingRight = `${gutter}px`;
    return () => {
      root.style.overflow = previousOverflow;
      root.style.paddingRight = previousPadding;
    };
  }, [mounted]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!mounted || !shell) return;
    const muted: Inertable[] = [];
    for (const node of Array.from(document.body.children)) {
      if (!(node instanceof HTMLElement) || node.contains(shell)) continue;
      const element = node as Inertable;
      if (element.inert) continue;
      element.inert = true;
      muted.push(element);
    }
    return () => { for (const element of muted) element.inert = false; };
  }, [mounted]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    const panel = panelRef.current;
    if (!panel) return;
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!nodes.length) {
      event.preventDefault();
      panel.focus({ preventScroll: true });
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, [close]);

  const handleDragEnd = useCallback((event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    setDragging(false);
    const pointerX = "clientX" in event ? event.clientX : event.changedTouches[0]?.clientX;
    const rawOffset = dragStartClientXRef.current === null || pointerX === undefined
      ? info.offset.x
      : pointerX - dragStartClientXRef.current;
    const trackedOffset = dragMaxOffsetXRef.current;
    dragStartClientXRef.current = null;
    dragMaxOffsetXRef.current = 0;
    const renderedWidth = panelRef.current?.getBoundingClientRect().width ?? width;
    if (Math.max(info.offset.x, rawOffset, trackedOffset) > renderedWidth * 0.25 || info.velocity.x > 520) {
      close();
      return;
    }
    glide(0);
  }, [close, glide, width]);

  if (!host || !mounted) return null;
  return createPortal(
    <div ref={shellRef} className="fixed inset-0 z-50 overflow-hidden" data-slot="drawer-root" data-state={open ? "open" : "closing"}>
      <motion.div aria-hidden="true" className="absolute inset-0 bg-[#171918]/28" style={{ opacity: veil }} onClick={close} data-slot="drawer-overlay" />
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={hintId}
        tabIndex={-1}
        style={{ x, width, maxWidth: "calc(100% - 20px)", touchAction: "pan-y", ...({ "--dialog-accent": dialogAccentForPathname(pathname) } as CSSProperties) }}
        drag="x"
        dragControls={controls}
        dragListener={false}
        dragMomentum={false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ top: 0, bottom: 0, left: 0, right: 1 }}
        onDragStart={() => setDragging(true)}
        onDragEnd={handleDragEnd}
        onKeyDown={handleKeyDown}
        className={cn("dialog-surface isolate absolute inset-y-0 right-0 flex flex-col border-l border-border text-foreground outline-none", dragging && "select-none", className)}
        data-slot="drawer-content"
      >
        <header
          className={cn("flex min-h-[68px] select-none items-start gap-3 border-b border-border px-5 py-4", dragging ? "cursor-grabbing" : "cursor-grab")}
          onPointerDown={(event) => {
            if (!open) return;
            dragStartClientXRef.current = event.clientX;
            dragMaxOffsetXRef.current = 0;
            controls.start(event);
          }}
          onPointerMove={(event) => {
            if (dragStartClientXRef.current === null) return;
            dragMaxOffsetXRef.current = Math.max(
              dragMaxOffsetXRef.current,
              event.clientX - dragStartClientXRef.current,
            );
          }}
          onPointerCancel={() => {
            dragStartClientXRef.current = null;
            dragMaxOffsetXRef.current = 0;
          }}
          data-slot="drawer-handle"
        >
          <span className="mt-0.5 h-8 w-1 shrink-0 bg-[var(--dialog-accent)]" aria-hidden="true" />
          <div className="min-w-0 flex-1"><h2 id={titleId} className="truncate font-heading text-base font-semibold">{title}</h2>{description ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{description}</p> : null}</div>
          <Button type="button" variant="ghost" size="icon" className="-mr-2 size-10" aria-label={intl("components_ui_drawer.closeDetails")} onPointerDown={(event) => event.stopPropagation()} onClick={close}><XIcon /><span className="sr-only">{intl("components_ui_drawer.closeDetails")}</span></Button>
        </header>
        <div data-yeye-scroll="auto" className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-slot="drawer-body">{children}</div>
        <span id={hintId} className="sr-only">{intl("components_ui_drawer.pressEscapeToCloseThePanelOrDragThe")}</span>
      </motion.div>
    </div>,
    host,
  );
}
