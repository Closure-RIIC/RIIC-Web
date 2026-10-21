"use client";
import { localize as rotationText } from "../i18n/helpers/RotationLabels.ts";

import { useTranslations, useLocale } from "use-intl";

import { useState } from "react";

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";

import {
  ROTATION_OPTIONS,
} from "../rotation-settings";
import type { RotationProfile } from "../types";

type RotationSettingsProps = {
  value: RotationProfile;
  onChange: (value: RotationProfile) => void;
};

export function RotationSettings({ value, onChange }: RotationSettingsProps) {
  const intl = useTranslations();
  const locale = useLocale();
  const en = locale === "en";
  const [query, setQuery] = useState<string | null>(null);
  const rotationComboboxOptions = ROTATION_OPTIONS.map((option) => ({
    value: option.profile,
    label: `${rotationText.text(en, option.profile)} · ${option.durations.join("/")}`,
  }));
  const selectedComboboxOption = rotationComboboxOptions.find((option) => option.value === value) ?? null;
  const normalizedQuery = query?.trim().toLocaleLowerCase((locale === "en" ? "en-US" : "zh-CN")) ?? "";
  const filteredOptions = normalizedQuery
    ? rotationComboboxOptions.filter((option) => option.label
      .toLocaleLowerCase((locale === "en" ? "en-US" : "zh-CN"))
      .includes(normalizedQuery))
    : rotationComboboxOptions;

  return (
    <section aria-labelledby="rotation-settings-title" className="grid gap-3">
      <h3 id="rotation-settings-title" className="text-sm font-semibold">{intl("components_RotationSettings.rotation")}</h3>
      <Label htmlFor="rotation-profile" className="sr-only">{intl("components_RotationSettings.rotation")}</Label>
      <Combobox
        items={rotationComboboxOptions}
        filteredItems={filteredOptions}
        value={selectedComboboxOption}
        inputValue={query ?? selectedComboboxOption?.label ?? ""}
        itemToStringValue={(option) => option.label}
        isItemEqualToValue={(option, selectedOption) => option.value === selectedOption.value}
        autoHighlight
        onInputValueChange={(inputValue) => setQuery(inputValue)}
        onOpenChange={(open) => {
          if (!open) setQuery(null);
        }}
        onValueChange={(option) => {
          if (option) {
            setQuery(null);
            onChange(option.value);
          }
        }}
      >
        <ComboboxInput
          id="rotation-profile"
          className="font-number h-11 w-full bg-background sm:max-w-md"
          aria-label={intl("components_RotationSettings.rotation")}
          placeholder={intl("components_RotationSettings.chooseARotation")}
          readOnly
        />
        <ComboboxContent align="start">
          <ComboboxEmpty className="block empty:p-0">{intl("components_RotationSettings.noMatchingRotation")}</ComboboxEmpty>
          <ComboboxList>
            {(option) => (
              <ComboboxItem key={option.value} value={option} className="font-number">
                {option.label}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </section>
  );
}
