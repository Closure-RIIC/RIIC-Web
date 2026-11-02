"use client";
import { localize as rotationText } from "@riic/arknights-domain/i18n/helpers/RotationLabels";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  ALLOWED_CYCLE_HOURS,
  CUSTOM_ROTATION,
  DEFAULT_CUSTOM_ROTATION,
  ROTATION_OPTIONS,
  ROTATION_TOPOLOGY_SHIFTS,
  defaultCustomRotation,
  isCustomRotation,
  validateCustomRotation,
  type CustomRotation,
  type RotationSelection,
} from "@riic/arknights-domain/rotation-settings";
import type { RotationTopology } from "@riic/arknights-domain/types";

type RotationSettingsProps = {
  value: RotationSelection;
  onChange: (value: RotationSelection) => void;
  /**
   * 自定义时长的当前设置。不传时不提供“自定义”选项——例如后台质检只能复用
   * 已保存的请求，无法新建自定义组合。
   */
  custom?: CustomRotation;
  onCustomChange?: (value: CustomRotation) => void;
};

const TOPOLOGIES: RotationTopology[] = ["main_backup", "abc"];

export function RotationSettings({ value, onChange, custom: customProp, onCustomChange }: RotationSettingsProps) {
  const allowCustom = customProp !== undefined && onCustomChange !== undefined;
  const custom = customProp ?? DEFAULT_CUSTOM_ROTATION;
  const intl = useTranslations();
  const locale = useLocale();
  const en = locale;
  const [query, setQuery] = useState<string | null>(null);
  const customLabel = intl("components_RotationSettings.custom");
  const rotationComboboxOptions = [
    ...ROTATION_OPTIONS.map((option) => ({
      value: option.profile as RotationSelection,
      label: `${rotationText.text(en, option.profile)} · ${option.durations.join("/")}`,
    })),
    ...(allowCustom ? [{ value: CUSTOM_ROTATION as RotationSelection, label: customLabel }] : []),
  ];
  const selectedComboboxOption = rotationComboboxOptions.find((option) => option.value === value) ?? null;
  const normalizedQuery = query?.trim().toLocaleLowerCase((locale)) ?? "";
  const filteredOptions = normalizedQuery
    ? rotationComboboxOptions.filter((option) => option.label
      .toLocaleLowerCase((locale))
      .includes(normalizedQuery))
    : rotationComboboxOptions;

  const showCustom = allowCustom && isCustomRotation(value);
  const problem = showCustom ? validateCustomRotation(custom) : null;
  const total = custom.hours.reduce((sum, hour) => sum + hour, 0);

  function changeTopology(topology: RotationTopology) {
    if (!onCustomChange || topology === custom.topology) return;
    // 换拓扑时给出一个合法默认值，避免直接停在无效状态。
    onCustomChange(defaultCustomRotation(topology));
  }

  function changeHour(index: number, raw: string) {
    if (!onCustomChange) return;
    const parsed = Number.parseInt(raw, 10);
    const hours = custom.hours.map((hour, position) => (position === index ? (Number.isFinite(parsed) ? parsed : 0) : hour));
    onCustomChange({ ...custom, hours });
  }

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

      {showCustom ? (
        <div className="grid gap-3 rounded-lg border border-border/70 p-3" data-rotation-custom>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-muted-foreground">{intl("components_RotationSettings.shiftCount")}</span>
            <Tabs
              value={custom.topology}
              onValueChange={(value) => changeTopology(value as RotationTopology)}
            >
              <TabsList aria-label={intl("components_RotationSettings.shiftCount")}>
                {TOPOLOGIES.map((topology) => (
                  <TabsTrigger key={topology} value={topology}>
                    {intl("components_RotationSettings.shiftCountN", { count: ROTATION_TOPOLOGY_SHIFTS[topology] })}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            {Array.from({ length: ROTATION_TOPOLOGY_SHIFTS[custom.topology] }, (_, index) => (
              <label key={index} className="grid gap-1">
                <span className="text-xs text-muted-foreground">
                  {intl("components_RotationSettings.shiftHoursLabel", { index: index + 1 })}
                </span>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  className="font-number h-10 w-24"
                  value={custom.hours[index] ?? ""}
                  aria-label={intl("components_RotationSettings.shiftHoursLabel", { index: index + 1 })}
                  onChange={(event) => changeHour(index, event.target.value)}
                />
              </label>
            ))}
          </div>

          <p
            className={`text-xs ${problem ? "text-destructive" : "text-muted-foreground"}`}
            role={problem ? "alert" : "status"}
            data-rotation-total
            data-invalid={problem ? "true" : undefined}
          >
            {problem?.kind === "cycle-total"
              ? intl("components_RotationSettings.cycleNotAllowed", {
                total: problem.total,
                allowed: ALLOWED_CYCLE_HOURS.join(" / "),
              })
              : problem?.kind === "hour-range"
                ? intl("components_RotationSettings.hourMustBePositiveInteger")
                : intl("components_RotationSettings.cycleTotal", { total })}
          </p>
        </div>
      ) : null}
    </section>
  );
}

export { DEFAULT_CUSTOM_ROTATION };
