"use client";

import { createLocalizer as createUiLocalizer } from "@riic/arknights-domain/i18n/localize";
import type UiMessages from "../../../messages/zh-CN/AK_components_pages_AccountHealthDemandSection.json";
const uiText = createUiLocalizer<typeof UiMessages>("AK_components_pages_AccountHealthDemandSection");
import type { AppLocale } from "@riic/contracts/locale";
import { ClipboardList } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { loadHealthDemand, persistHealthDemand, type HealthDemand, type HealthDemandField } from "@/account-health-demand";
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";

type Choice = { value: string; label: keyof typeof UiMessages };
type Field = { key: HealthDemandField; label: keyof typeof UiMessages; choices: Choice[] };

const FIELDS: Field[] = [
  { key: "orundumPlan", label: "field_orundumPlan", choices: [
    { value: "none", label: "choice_orundumPlan_none" },
    { value: "planned", label: "choice_orundumPlan_planned" },
  ] },
  { key: "outputPriority", label: "field_outputPriority", choices: [
    { value: "maximize", label: "choice_outputPriority_maximize" },
    { value: "balanced", label: "choice_outputPriority_balanced" },
    { value: "low-maintenance", label: "choice_outputPriority_low_maintenance" },
  ] },
  { key: "resourceFocus", label: "field_resourceFocus", choices: [
    { value: "balanced", label: "choice_resourceFocus_balanced" },
    { value: "lmd", label: "choice_resourceFocus_lmd" },
    { value: "experience", label: "choice_resourceFocus_experience" },
  ] },
  { key: "layoutChange", label: "field_layoutChange", choices: [
    { value: "keep", label: "choice_layoutChange_keep" },
    { value: "recipes-only", label: "choice_layoutChange_recipes_only" },
    { value: "rebuild-ok", label: "choice_layoutChange_rebuild_ok" },
  ] },
  { key: "twoPowerPlants", label: "field_twoPowerPlants", choices: [
    { value: "accept", label: "choice_twoPowerPlants_accept" },
    { value: "avoid", label: "choice_twoPowerPlants_avoid" },
  ] },
  { key: "loginCadence", label: "field_loginCadence", choices: [
    { value: "twice-daily", label: "choice_loginCadence_twice_daily" },
    { value: "daily", label: "choice_loginCadence_daily" },
    { value: "irregular", label: "choice_loginCadence_irregular" },
  ] },
];

export function AccountHealthDemandSection({ identityKey, en, hidden = false, onChange }: { identityKey: string; en: AppLocale; hidden?: boolean; onChange?: (value: HealthDemand) => void }) {
  const [demand, setDemand] = useState<HealthDemand>({});
  const fields = useMemo(() => FIELDS.map((field) => ({ ...field, options: [
    { value: "", label: uiText.text(en, "notSpecified") },
    ...field.choices.map((choice) => ({ value: choice.value, label: uiText.text(en, choice.label) })),
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
        <h2 id="account-health-demand-title" className="flex items-center gap-2 text-sm font-semibold"><ClipboardList className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />{uiText.text(en, "infrastructureUsagePreferences")}</h2>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{uiText.text(en, "onlySettledChoicesBelongHereUnsetItemsFall")}</p>
        <div className="mt-4 grid gap-4 border-t border-border pt-4 sm:grid-cols-2 md:gap-x-6 md:gap-y-5 xl:grid-cols-3">
          {fields.map((field) => {
            const options = field.options;
            const selected = options.find((option) => option.value === (demand[field.key] ?? "")) ?? options[0];
            return (
            <div key={field.key} className="grid min-w-0 gap-2">
              <label htmlFor={`health-demand-${field.key}`} className="text-xs text-muted-foreground">
                {uiText.text(en, field.label)}
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
