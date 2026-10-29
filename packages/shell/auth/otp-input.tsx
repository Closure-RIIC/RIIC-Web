"use client";
import { useTranslations } from "use-intl";

/**
 * Adapted from Interior's OTP Input component.
 * Copyright (c) 2026 ozzy. MIT license: ./LICENSE
 */
import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type FocusEvent,
  type KeyboardEvent,
  type Ref,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

export type OtpStatus = "idle" | "error" | "success";
export type OtpInputHandle = { clear: () => void; focus: () => void };

type OtpCellProps = {
  ref: (element: HTMLInputElement | null) => void;
  value: string;
  disabled: boolean;
  type: "text";
  inputMode: "numeric";
  autoComplete: string;
  autoCorrect: "off";
  autoCapitalize: "off";
  spellCheck: false;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLInputElement>) => void;
  onFocus: (event: FocusEvent<HTMLInputElement>) => void;
  onBlur: (event: FocusEvent<HTMLInputElement>) => void;
};

function useOtpInput(length: number, disabled: boolean, onChange?: (value: string) => void, onComplete?: (value: string) => void) {
  const [chars, setChars] = useState(() => Array.from({ length }, () => ""));
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const charsRef = useRef(chars);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const changeCallback = useRef(onChange);
  const completeCallback = useRef(onComplete);

  useEffect(() => {
    charsRef.current = chars;
  }, [chars]);

  useEffect(() => {
    changeCallback.current = onChange;
    completeCallback.current = onComplete;
  }, [onChange, onComplete]);

  const focusAt = useCallback((index: number) => {
    const element = refs.current[Math.max(0, Math.min(length - 1, index))];
    element?.focus();
    element?.select();
  }, [length]);

  const commit = useCallback((next: string[]) => {
    charsRef.current = next;
    setChars(next);
    const value = next.join("");
    changeCallback.current?.(value);
    if (next.every(Boolean)) completeCallback.current?.(value);
  }, []);

  const fillFrom = useCallback((index: number, text: string) => {
    const incoming = text.replace(/\D/g, "");
    if (!incoming) return;
    const next = [...charsRef.current];
    let cursor = index;
    for (const character of incoming) {
      if (cursor >= length) break;
      next[cursor] = character;
      cursor += 1;
    }
    commit(next);
    focusAt(cursor);
  }, [commit, focusAt, length]);

  const clear = useCallback(() => {
    commit(Array.from({ length }, () => ""));
    focusAt(0);
  }, [commit, focusAt, length]);

  const getCellProps = useCallback((index: number): OtpCellProps => ({
    ref: (element) => { refs.current[index] = element; },
    value: chars[index] ?? "",
    disabled,
    type: "text",
    inputMode: "numeric",
    autoComplete: index === 0 ? "one-time-code" : "off",
    autoCorrect: "off",
    autoCapitalize: "off",
    spellCheck: false,
    onChange: (event) => {
      const raw = event.currentTarget.value;
      const previous = charsRef.current[index] ?? "";
      const incoming = raw.length > 1 && previous && raw.startsWith(previous) ? raw.slice(previous.length) : raw;
      if (!/\d/.test(incoming)) {
        if (!raw && previous) {
          const next = [...charsRef.current];
          next[index] = "";
          commit(next);
        }
        return;
      }
      fillFrom(index, incoming);
    },
    onKeyDown: (event) => {
      if (event.key === "Backspace") {
        event.preventDefault();
        const next = [...charsRef.current];
        if (next[index]) next[index] = "";
        else if (index > 0) {
          next[index - 1] = "";
          focusAt(index - 1);
        }
        commit(next);
      } else if (event.key === "Delete") {
        event.preventDefault();
        const next = [...charsRef.current];
        next[index] = "";
        commit(next);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        focusAt(index - 1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        focusAt(index + 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        focusAt(0);
      } else if (event.key === "End") {
        event.preventDefault();
        focusAt(length - 1);
      }
    },
    onPaste: (event) => {
      event.preventDefault();
      const incoming = event.clipboardData.getData("text").replace(/\D/g, "");
      fillFrom(incoming.length >= length ? 0 : index, incoming);
    },
    onFocus: (event) => {
      event.currentTarget.select();
      const firstEmpty = charsRef.current.findIndex((character) => !character);
      if (firstEmpty !== -1 && firstEmpty < index) focusAt(firstEmpty);
      else setFocusedIndex(index);
    },
    onBlur: (event) => {
      const next = event.relatedTarget as HTMLInputElement | null;
      if (!next || !refs.current.includes(next)) setFocusedIndex(-1);
    },
  }), [chars, commit, disabled, fillFrom, focusAt, length]);

  return { chars, focusedIndex, focusAt, clear, getCellProps };
}

export function OtpInput({
  length = 6,
  onChange,
  onComplete,
  status = "idle",
  errorMessage = "",
  successMessage = "",
  hint = "",
  label,
  disabled = false,
  autoFocus = false,
  className = "",
  ref,
}: {
  length?: number;
  onChange?: (value: string) => void;
  onComplete?: (value: string) => void;
  status?: OtpStatus;
  errorMessage?: string;
  successMessage?: string;
  hint?: string;
  label?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  ref?: Ref<OtpInputHandle>;
}) {
  const intl = useTranslations("Account");
  const reduced = useReducedMotion();

  const resolvedLabel = label ?? (intl("components_interior_otp_input.emailVerificationCode"));
  const statusId = useId();
  const { chars, focusedIndex, focusAt, clear, getCellProps } = useOtpInput(length, disabled, onChange, onComplete);
  const error = status === "error";
  const success = status === "success";
  const message = error ? errorMessage : success ? successMessage : hint;

  useImperativeHandle(ref, () => ({ clear, focus: () => focusAt(0) }), [clear, focusAt]);
  useEffect(() => { if (autoFocus && !disabled) focusAt(0); }, [autoFocus, disabled, focusAt]);

  return (
    <div className={`flex min-w-0 flex-col ${className}`}>
      <motion.div
        role="group"
        aria-label={resolvedLabel}
        className="flex justify-center gap-1.5 sm:gap-2"
        initial={false}
        variants={{ idle: { x: 0 }, wrong: { x: [0, -5, 4, -3, 0] } }}
        animate={error && !reduced ? "wrong" : "idle"}
        transition={{ duration: reduced ? 0 : 0.32, ease: [0.23, 1, 0.32, 1] }}
      >
        {chars.map((character, index) => {
          const active = focusedIndex === index;
          return (
            <div key={index} className={`relative aspect-square w-11 min-w-0 shrink min-[420px]:w-12 ${index === 3 ? "ml-1.5 sm:ml-3" : ""}`}>
              <input
                {...getCellProps(index)}
                aria-label={intl("components_interior_otp_input.digitOf", { resolvedLabel: resolvedLabel, value2: index + 1, length: length })}
                aria-invalid={error || undefined}
                aria-describedby={message ? statusId : undefined}
                className={`font-number size-full rounded-lg border-2 text-center text-base text-transparent caret-transparent outline-none transition-[background-color,border-color,box-shadow] duration-150 focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-50 ${
                  error ? "border-destructive bg-background" : success ? "border-emerald-500 bg-background" : active ? "border-primary bg-background" : character ? "border-border bg-background" : "border-border bg-muted/45 shadow-inner"
                }`}
              />
              <span aria-hidden="true" className="pointer-events-none absolute inset-0 grid place-items-center font-number text-base tabular-nums">
                <AnimatePresence initial={false} mode="popLayout">
                  {character ? (
                    <motion.span
                      key={character}
                      initial={reduced ? false : { opacity: 0, scale: 0.96, y: 8 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={reduced ? { duration: 0 } : { duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
                    >
                      {character}
                    </motion.span>
                  ) : null}
                </AnimatePresence>
                {active && !character && !disabled ? <span className="h-[18px] w-0.5 animate-pulse rounded bg-foreground" /> : null}
              </span>
            </div>
          );
        })}
      </motion.div>
      {message ? (
        <p id={statusId} role="status" className={`mt-2 text-xs ${error ? "text-destructive" : success ? "text-emerald-700" : "text-muted-foreground"}`}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
