"use client";

import { useTranslations } from "use-intl";
import { SelectionButton } from "@riic/ui-primitives/selection-button";

export function OwnedOperatorFilter({ value, onChange }: {
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const intl = useTranslations();
  return (
    <SelectionButton
      type="button"
      size="dialog"
      className="h-11 min-w-[92px] rounded-[18px] px-2 text-[11px] font-normal max-sm:min-w-[92px] sm:h-9 sm:min-w-[104px] sm:px-2 sm:text-xs"
      selected={value}
      onSelectedChange={onChange}
    >
      {intl("components_setup_ManualOperboxPicker.ownedOnly")}
    </SelectionButton>
  );
}
