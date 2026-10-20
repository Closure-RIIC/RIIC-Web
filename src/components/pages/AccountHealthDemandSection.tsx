"use client";

import { ClipboardList } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { loadHealthDemand, persistHealthDemand, type HealthDemand, type HealthDemandField } from "@/account-health-demand";
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";

type Choice = { value: string; zh: string; en: string };
type Field = { key: HealthDemandField; zh: string; en: string; choices: Choice[] };

const FIELDS: Field[] = [
  { key: "orundumPlan", zh: "搓玉计划", en: "Orundum production", choices: [
    { value: "none", zh: "暂无", en: "No plan" },
    { value: "planned", zh: "计划进行", en: "Planned" },
  ] },
  { key: "outputPriority", zh: "产出与操作取向", en: "Output and effort", choices: [
    { value: "maximize", zh: "优先最大产出", en: "Maximize output" },
    { value: "balanced", zh: "兼顾产出与省心", en: "Balanced" },
    { value: "low-maintenance", zh: "优先省心", en: "Low maintenance" },
  ] },
  { key: "resourceFocus", zh: "资源侧重点", en: "Resource focus", choices: [
    { value: "balanced", zh: "钱书均衡", en: "Balanced LMD and EXP" },
    { value: "lmd", zh: "龙门币", en: "LMD" },
    { value: "experience", zh: "作战记录", en: "EXP" },
  ] },
  { key: "layoutChange", zh: "布局调整范围", en: "Layout changes", choices: [
    { value: "keep", zh: "保持现有布局", en: "Keep layout" },
    { value: "recipes-only", zh: "可调整产线与订单", en: "Recipes and orders only" },
    { value: "rebuild-ok", zh: "可重建布局", en: "Rebuild allowed" },
  ] },
  { key: "twoPowerPlants", zh: "两发电布局", en: "Two power plants", choices: [
    { value: "accept", zh: "可以接受", en: "Accept" },
    { value: "avoid", zh: "不接受", en: "Avoid" },
  ] },
  { key: "loginCadence", zh: "通常上线节奏", en: "Usual check-in", choices: [
    { value: "twice-daily", zh: "每天至少两次", en: "At least twice daily" },
    { value: "daily", zh: "大致每天一次", en: "About once daily" },
    { value: "irregular", zh: "不规律", en: "Irregular" },
  ] },
];

export function AccountHealthDemandSection({ identityKey, en, hidden = false, onChange }: { identityKey: string; en: boolean; hidden?: boolean; onChange?: (value: HealthDemand) => void }) {
  const [demand, setDemand] = useState<HealthDemand>({});
  const fields = useMemo(() => FIELDS.map((field) => ({ ...field, options: [
    { value: "", label: en ? "Not specified" : "未设置" },
    ...field.choices.map((choice) => ({ value: choice.value, label: en ? choice.en : choice.zh })),
  ] })), [en]);
  useEffect(() => {
    setDemand(loadHealthDemand(window.localStorage, identityKey) ?? {});
  }, [identityKey]);

  const update = (field: HealthDemandField, value: string) => {
    const next = { ...demand, [field]: value || undefined };
    setDemand(next);
    onChange?.(next);
    try { persistHealthDemand(window.localStorage, identityKey, next); } catch { /* Keep the current selection. */ }
  };

  if (hidden) return null;
  return (
    <section aria-labelledby="account-health-demand-title" data-account-health-demand className="min-w-0 rounded-[4px] border border-border bg-card p-3 md:p-6">
        <h2 id="account-health-demand-title" className="flex items-center gap-2 text-sm font-semibold"><ClipboardList className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />{en ? "Infrastructure usage preferences" : "基建使用偏好"}</h2>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{en ? "Only settled choices belong here; unset items fall back to neutral defaults and do not affect other answers." : "每项只保留已定的选择；尚未决定的项保持未设置即可，按中性默认处理，不影响其他判断。"}</p>
        <div className="mt-4 grid gap-4 border-t border-border pt-4 sm:grid-cols-2 md:gap-x-6 md:gap-y-5 xl:grid-cols-3">
          {fields.map((field) => {
            const options = field.options;
            const selected = options.find((option) => option.value === (demand[field.key] ?? "")) ?? options[0];
            return (
            <div key={field.key} className="grid min-w-0 gap-2">
              <label htmlFor={`health-demand-${field.key}`} className="text-xs text-muted-foreground">
                {en ? field.en : field.zh}
              </label>
              <Combobox
                items={options}
                filteredItems={options}
                value={selected}
                inputValue={selected.label}
                itemToStringValue={(option) => option.label}
                isItemEqualToValue={(option, current) => option.value === current.value}
                onValueChange={(option) => { if (option) update(field.key, option.value); }}
              >
                <ComboboxInput id={`health-demand-${field.key}`} readOnly className="h-11 w-full min-w-0 md:h-9" />
                <ComboboxContent align="start">
                  <ComboboxList>
                    {(option) => <ComboboxItem key={option.value} value={option}>{option.label}</ComboboxItem>}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </div>
            );
          })}
        </div>
    </section>
  );
}
