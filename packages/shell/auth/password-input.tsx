"use client";
import { useTranslations } from "use-intl";

import { Eye, EyeOff } from "lucide-react";
import { useState, type ComponentProps } from "react";

import { Input } from "@riic/ui-primitives/input";
import { cn } from "@riic/ui-primitives/utils";

type PasswordInputProps = Omit<ComponentProps<typeof Input>, "type"> & {
  hideLabel?: string;
  revealLabel?: string;
  toggleClassName?: string;
};

export function PasswordInput({ className, disabled, hideLabel, id, revealLabel, toggleClassName, ...props }: PasswordInputProps) {
  const intl = useTranslations();

  const [revealed, setRevealed] = useState(false);
  const resolvedRevealLabel = revealLabel ?? (intl("components_auth_password_input.showPassword"));
  const toggleLabel = revealed
    ? hideLabel ?? (resolvedRevealLabel.startsWith("Show ") ? resolvedRevealLabel.replace(/^Show /, "Hide ") : resolvedRevealLabel.replace(/^显示/, "隐藏"))
    : resolvedRevealLabel;

  return (
    <div className="relative">
      <Input
        {...props}
        id={id}
        type={revealed ? "text" : "password"}
        disabled={disabled}
        className={cn("pr-11", className)}
      />
      <button
        type="button"
        className={cn(
          "absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50",
          toggleClassName,
        )}
        aria-label={toggleLabel}
        aria-controls={id}
        aria-pressed={revealed}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setRevealed((current) => !current)}
      >
        {revealed ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
      </button>
    </div>
  );
}
