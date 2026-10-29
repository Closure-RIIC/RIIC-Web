"use client";

import { lazyWithMessages } from "@/i18n/features-client";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Keyboard } from "lucide-react";
import { useTranslations } from "use-intl";
import styles from "./WorkbenchDock.module.css";

const ShortcutGuideDialog = lazyWithMessages(() => import("@/components").then((module) => ({ default: module.ShortcutGuideDialog })), "apps/arknights/src/components.tsx");

function CalculatorShortcuts() {
  const intl = useTranslations();
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState(false);
  const label = intl("components_pages_InfraCalculator.keyboardShortcuts");

  return <>
    <button
      type="button"
      className={`${styles.button} ${styles.iconButton}`}
      aria-label={label}
      title={label}
      aria-haspopup="dialog"
      onClick={() => { setRequested(true); setOpen(true); }}
      data-workbench-shortcuts
    >
      <Keyboard size={15} aria-hidden="true" />
    </button>
    {requested ? <Suspense fallback={null}>
      <ShortcutGuideDialog open={open} onOpenChange={setOpen} />
    </Suspense> : null}
  </>;
}

export function WorkbenchDock({ showShortcuts, children }: { showShortcuts: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return null;
  return createPortal(<div className={styles.dock} data-workbench-dock>
    {showShortcuts ? <CalculatorShortcuts /> : null}
    {children}
  </div>, document.body);
}
