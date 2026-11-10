"use client";

import { useTranslations, useLocale } from "use-intl";

import { useEffect, useState } from "react";

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
  DEFAULT_CUSTOM_ROTATION,
  ROTATION_OPTIONS,
  SELECTABLE_ROTATION_OPTIONS,
  rotationName,
  ROTATION_TOPOLOGY_SHIFTS,
  defaultCustomRotation,
  encodeRotationKey,
  isCustomRotationKey,
  toRotationTiming,
  validateCustomRotation,
  type CustomRotation,
} from "@riic/arknights-domain/rotation-settings";
import type { RotationTopology } from "@riic/arknights-domain/types";
import { autoRotationFromKey, DEFAULT_AUTO_ROTATION_HOURS, encodeAutoRotationKey } from "@riic/arknights-domain/auto-rotation";

type RotationSettingsProps = {
  /** 换班方式 key：named profile、custom_zb_16_8 或 auto_32_32。 */
  value: string;
  onChange: (value: string) => void;
  /**
   * 自定义时长的当前设置。不传时不提供“自定义”选项——例如后台质检只能复用
   * 已保存的请求，无法新建自定义组合。
   */
  custom?: CustomRotation;
  onCustomChange?: (value: CustomRotation) => void;
  /** 自定义时长是否合法；父组件据此禁用提交按钮。 */
  onValidityChange?: (valid: boolean) => void;
  allowAuto?: boolean;
};

const TOPOLOGIES: RotationTopology[] = ["main_backup", "abc"];

/** 下拉框“自定义”选项的值；不是轮换方式本身。 */
const CUSTOM_OPTION = "__custom__";
const AUTO_OPTION = "__auto__";

export function RotationSettings({
  value,
  onChange,
  custom: customProp,
  onCustomChange,
  onValidityChange,
  allowAuto = false,
}: RotationSettingsProps) {
  const allowCustom = customProp !== undefined && onCustomChange !== undefined;
  const custom = customProp ?? DEFAULT_CUSTOM_ROTATION;
  const intl = useTranslations();
  const locale = useLocale();
  const en = locale;
  const [query, setQuery] = useState<string | null>(null);
  /**
   * 输入框正在编辑的原始文本（按班次下标）。
   * 允许暂时为空或不合法，避免用户删光后立刻被改写；失焦时再钳制到 >= 1。
   */
  const [draftHours, setDraftHours] = useState<Record<number, string>>({});
  const autoHours = autoRotationFromKey(value);
  const autoLabel = intl("components_RotationSettings.auto");
  const customLabel = intl("components_RotationSettings.custom");
  const rotationComboboxOptions = [
    ...SELECTABLE_ROTATION_OPTIONS.map((option) => ({
      value: option.profile as string,
      label: `${rotationName(option.profile, en)} ${option.durations.join("/")}`,
    })),
    ...(allowAuto ? [{ value: AUTO_OPTION, label: autoLabel }] : []),
    ...(allowCustom ? [{ value: CUSTOM_OPTION, label: customLabel }] : []),
  ];
  // 自定义编码（custom_xxx）在下拉框里对应“自定义”选项。
  const comboboxValue = autoHours ? AUTO_OPTION : isCustomRotationKey(value) ? CUSTOM_OPTION : value;
  const legacyOption = ROTATION_OPTIONS.find((option) => option.profile === comboboxValue);
  const selectedComboboxOption = rotationComboboxOptions.find((option) => option.value === comboboxValue)
    ?? (legacyOption ? { value: legacyOption.profile, label: `${rotationName(legacyOption.profile, en)} ${legacyOption.durations.join("/")}` } : null);
  const normalizedQuery = query?.trim().toLocaleLowerCase((locale)) ?? "";
  const filteredOptions = normalizedQuery
    ? rotationComboboxOptions.filter((option) => option.label
      .toLocaleLowerCase((locale))
      .includes(normalizedQuery))
    : rotationComboboxOptions;

  const showCustom = allowCustom && isCustomRotationKey(value);
  const problem = showCustom ? validateCustomRotation(custom) : null;
  const total = custom.hours.reduce((sum, hour) => sum + hour, 0);

  // 只在“自定义”生效时上报合法性；预设项永远合法。
  const valid = !showCustom || problem === null;
  useEffect(() => {
    onValidityChange?.(valid);
  }, [onValidityChange, valid]);

  function changeTopology(topology: RotationTopology) {
    if (!onCustomChange || topology === custom.topology) return;
    // 换拓扑时给出一个合法默认值，避免直接停在无效状态。
    onCustomChange(defaultCustomRotation(topology));
  }

  function editHour(index: number, raw: string) {
    setDraftHours((current) => ({ ...current, [index]: raw }));
  }

  /** 失焦提交：非正整数一律按 1 处理（输入框 min={1} 只是浏览器提示）。 */
  function commitHour(index: number) {
    const draft = draftHours[index];
    if (draft === undefined) return;
    setDraftHours((current) => {
      const next = { ...current };
      delete next[index];
      return next;
    });
    if (!onCustomChange) return;
    const parsed = Number.parseInt(draft, 10);
    const hour = Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
    if (hour === custom.hours[index]) return;
    const hours = custom.hours.map((value, position) => (position === index ? hour : value));
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
            onChange(option.value === AUTO_OPTION
              ? encodeAutoRotationKey(DEFAULT_AUTO_ROTATION_HOURS)
              : option.value === CUSTOM_OPTION ? encodeRotationKey(toRotationTiming(custom)) : option.value);
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

      {allowAuto && autoHours ? (
        <div className="grid gap-3 rounded-lg border border-border/70 p-3" data-rotation-auto>
          <p className="text-xs text-muted-foreground">{intl("components_RotationSettings.autoDescription")}</p>
        </div>
      ) : null}

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
                  value={draftHours[index] ?? String(custom.hours[index] ?? "")}
                  aria-label={intl("components_RotationSettings.shiftHoursLabel", { index: index + 1 })}
                  onChange={(event) => editHour(index, event.target.value)}
                  onBlur={() => commitHour(index)}
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
