"use client";
import { useTranslations } from "use-intl";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

export type WizardStep = {
  id: string;
  label: string;
};

type WizardStepsProps = {
  steps: WizardStep[];
  value: string;
  onValueChange: (value: string) => void;
  label?: string;
  className?: string;
};

const RAIL_TRANSITION = { type: "spring", stiffness: 520, damping: 40, mass: 0.5 } as const;

export function WizardSteps({
  steps,
  value,
  onValueChange,
  label,
  className = "",
}: WizardStepsProps) {
  const intl = useTranslations();

  const accessibleLabel = label ?? (intl("components_interior_wizard_steps.setupSteps"));
  const currentIndex = Math.max(0, steps.findIndex((step) => step.id === value));
  const [furthest, setFurthest] = useState(currentIndex);
  const reduced = useReducedMotion();
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    setFurthest((current) => Math.max(current, currentIndex));
  }, [currentIndex]);

  function goTo(index: number) {
    if (index < 0 || index >= steps.length || index > furthest || index === currentIndex) return;
    onValueChange(steps[index].id);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    let target = currentIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") target += 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") target -= 1;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = furthest;
    else return;
    event.preventDefault();
    goTo(Math.min(target, furthest));
    window.requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLButtonElement>('button[aria-current="step"]')?.focus();
    });
  }

  return (
    <div className={`w-full ${className}`} data-wizard-steps>
      <span className="mb-2 grid select-none text-[13px] font-medium text-muted-foreground" aria-hidden="true">
        {steps.map((step, index) => (
          <motion.span
            key={step.id}
            className="col-start-1 row-start-1 truncate"
            initial={false}
            animate={{ opacity: index === currentIndex ? 1 : 0 }}
            transition={reduced ? { duration: 0 } : RAIL_TRANSITION}
          >
            {intl.rich("components_interior_wizard_steps.rich1", { element1: (chunks) => (<span className="font-number">{chunks}</span>), value2: () => (index + 1), value3: () => (steps.length), value4: () => (step.label) })}
          </motion.span>
        ))}
      </span>
      <ol ref={listRef} aria-label={accessibleLabel} className="flex list-none items-center gap-1 p-0">
        {steps.map((step, index) => {
          const done = index < currentIndex;
          const current = index === currentIndex;
          const available = index <= furthest;
          const tile = (
            <motion.span
              aria-hidden="true"
              className={`grid size-7 place-items-center rounded-[8px] border text-[11.5px] font-medium tabular-nums shadow-xs transition-colors duration-150 ${
                done
                  ? "border-[#313131] bg-[#313131] text-white"
                  : current
                    ? "border-muted-foreground/45 bg-background text-foreground"
                    : "border-border bg-background text-muted-foreground"
              }`}
              initial={false}
              animate={{ scale: current ? 1 : 0.92 }}
              transition={reduced ? { duration: 0 } : RAIL_TRANSITION}
            >
              {done ? <Check className="size-3.5" /> : index + 1}
            </motion.span>
          );

          return (
            <li key={step.id} className="flex flex-1 items-center gap-1 last:flex-none">
              {available ? (
                <button
                  type="button"
                  aria-current={current ? "step" : undefined}
                  aria-label={intl("components_interior_wizard_steps.stepOf", { value1: index + 1, length: steps.length, label: step.label })}
                  tabIndex={current ? 0 : -1}
                  onKeyDown={handleKeyDown}
                  onClick={() => goTo(index)}
                  className="rounded-[8px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {tile}
                </button>
              ) : (
                <span aria-label={intl("components_interior_wizard_steps.stepOf", { value1: index + 1, length: steps.length, label: step.label })}>{tile}</span>
              )}
              {index < steps.length - 1 ? (
                <span aria-hidden="true" className="relative h-[3px] flex-1 overflow-hidden rounded-[2px] bg-muted shadow-inner">
                  <motion.span
                    className="absolute inset-0 origin-left rounded-[2px] bg-[#313131]"
                    initial={false}
                    animate={{ scaleX: index < currentIndex ? 1 : 0 }}
                    transition={reduced ? { duration: 0 } : RAIL_TRANSITION}
                  />
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
