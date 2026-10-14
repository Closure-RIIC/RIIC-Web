"use client";

import { useTranslations } from "use-intl";
import { SetupActionButton } from "@/components/setup/SetupActionButton";

export function OwnedOperatorFilter({ value, onChange }: {
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const intl = useTranslations();
  return (
    <SetupActionButton
      type="button"
      variant={value ? "default" : "outline"}
      className="min-w-[92px] px-2 text-[11px] font-normal max-sm:min-w-[92px] sm:min-w-[104px] sm:px-2 sm:text-xs"
      aria-pressed={value}
      onClick={() => onChange(!value)}
    >
      {intl("components_setup_ManualOperboxPicker.ownedOnly")}
    </SetupActionButton>
  );
}
