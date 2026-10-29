"use client";
import { authText, messageRecord } from "./messages";
import { useTranslations, useLocale } from "use-intl";

/**
 * Adapted from Interior's Password Strength component.
 * Copyright (c) 2026 ozzy. MIT license: ./LICENSE
 */
import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

import { evaluatePasswordStrength } from "@riic/arknights-domain/password-strength";

const CELL = { type: "spring", stiffness: 520, damping: 34, mass: 0.45 } as const;
const CROSSFADE = { type: "spring", stiffness: 260, damping: 34, mass: 0.8 } as const;
const INSTANT = { duration: 0 } as const;

export function PasswordStrength({ value, className = "", id }: { value: string; className?: string; id?: string }) {
  const intl = useTranslations("Account");
  const locale = useLocale();
  const en = locale;
  const reduced = useReducedMotion();
  const labels = messageRecord(en, "components_interior_password_strength_labels");
  const state = useMemo(() => {
    const strength = evaluatePasswordStrength(value);
    const rules = strength.rules.map((rule) => ({
      ...rule,
      label: authText.text(en, rule.id),
    }));
    const unmet = rules.filter((rule) => !rule.met);
    const announcement = value.length === 0
      ? ""
      : intl("AuthValidation.announcement", { strength: labels[strength.score], guessable: strength.guessable ? "yes" : "no", unmet: unmet.length ? "yes" : "no", rules: unmet.map((rule) => rule.label).join(en === "en" ? ", " : "、") });
    return { ...strength, rules, announcement };
  }, [en, value, intl, labels]);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    if (!state.announcement) {
      setAnnouncement("");
      return;
    }
    const timeout = window.setTimeout(() => setAnnouncement(state.announcement), 700);
    return () => window.clearTimeout(timeout);
  }, [state.announcement]);

  const tone = state.score === 0
    ? { bar: "bg-muted-foreground/25", text: "text-muted-foreground" }
    : state.score <= 1
      ? { bar: "bg-destructive", text: "text-destructive" }
      : state.score <= 2
        ? { bar: "bg-amber-500", text: "text-amber-700" }
        : { bar: "bg-emerald-500", text: "text-emerald-700" };

  return (
    <div id={id} className={`w-full ${className}`} data-password-strength>
      <div
        role="meter"
        aria-label={intl("components_interior_password_strength.passwordStrength2")}
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={state.score}
        aria-valuetext={labels[state.score]}
        className="grid grid-cols-4 gap-1.5"
      >
        {state.rules.map((rule, index) => (
          <div key={rule.id} className="relative h-1.5 overflow-hidden rounded-sm bg-muted">
            <motion.span
              className={`absolute inset-0 origin-left rounded-sm ${tone.bar}`}
              initial={false}
              animate={{ scaleX: index < state.score ? 1 : 0 }}
              transition={reduced ? INSTANT : { ...CELL, delay: index < state.score ? index * 0.03 : 0 }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex min-h-5 items-center justify-between gap-3 text-xs">
        <span className={`font-medium ${tone.text}`}>{intl("components_interior_password_strength.passwordStrength3", { value1: labels[state.score] })}</span>
        <motion.span
          aria-hidden="true"
          className="text-amber-700"
          initial={false}
          animate={{ opacity: state.guessable ? 1 : 0 }}
          transition={reduced ? INSTANT : CROSSFADE}
        >
          {intl("components_interior_password_strength.easyToGuess")}
        </motion.span>
      </div>
      <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        {state.rules.map((rule) => (
          <li key={rule.id} className={`flex items-center gap-1.5 text-xs ${rule.met ? "text-foreground" : "text-muted-foreground"}`}>
            <span className={`grid size-3.5 shrink-0 place-items-center rounded border ${rule.met ? "border-emerald-500 bg-emerald-500 text-white" : "border-border"}`} aria-hidden="true">
              {rule.met ? "✓" : null}
            </span>
            {rule.label}
            <span className="sr-only">{rule.met ? (intl("components_interior_password_strength.met")) : (intl("components_interior_password_strength.notMet"))}</span>
          </li>
        ))}
      </ul>
      <p aria-live="polite" className="sr-only">{announcement}</p>
    </div>
  );
}
