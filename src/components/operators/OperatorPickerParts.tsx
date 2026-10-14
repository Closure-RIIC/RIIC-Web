"use client";
import { useTranslations, useLocale } from "use-intl";
import { messageRecord } from "@/i18n/translate";

import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { LoadMore } from "@/components/ui/load-more";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { localizedOperatorName } from "@/i18n/game-data";
import { useGameCatalog } from "@/i18n/game-data-client";
import { PROFESSION_LABELS, PROFESSION_LABELS_ENGLISH } from "@/operator-presentation";
import { cn } from "@/lib/utils";

export const OPERATOR_PAGE_SIZE = 48;
const PROFESSIONS = [8, 1, 3, 2, 6, 4, 5, 7];

/** Shared presentation only: callers own the edit/single-select interaction. */
export function OperatorIdentity({ name, portrait, compact = false, children }: {
  name: string; portrait?: string; compact?: boolean; children: ReactNode;
}) {
  const intl = useTranslations();
  const locale = useLocale();
  const gameCatalog = useGameCatalog();
  const displayName = localizedOperatorName(name, locale, gameCatalog);
  return <>
    <span className={cn("shrink-0 overflow-hidden border border-border bg-muted", compact ? "size-10" : "size-12 sm:size-14")}>
      {portrait ? <img src={portrait} alt={intl("components_operators_OperatorPickerParts.portrait", { displayName: displayName })} className="size-full object-cover" loading="lazy" decoding="async" /> : null}
    </span>
    <span className="min-w-0">
      <span className="block truncate text-sm font-semibold">{displayName}</span>
      <span className={cn("flex min-w-0 flex-wrap items-center gap-1", compact ? "mt-0.5" : "mt-1")}>{children}</span>
    </span>
  </>;
}

export function OperatorSearch({ value, onChange, compact = false, autoFocus = false, label, placeholder }: {
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
  autoFocus?: boolean;
  label?: string;
  placeholder?: string;
}) {
  const intl = useTranslations();

  const defaultLabel = intl("components_operators_OperatorPickerParts.searchOperator");
  return <label className="relative block min-w-0">
    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
    <Input autoFocus={autoFocus} value={value} onChange={(event) => onChange(event.target.value)} className={cn("pl-9", compact ? "h-9 max-sm:h-11" : "h-11")} placeholder={placeholder ?? label ?? defaultLabel} aria-label={label ?? defaultLabel} />
  </label>;
}

type FilterProps = { value: string; onChange: (value: string) => void; disabled?: boolean };
export function OperatorRarityFilter({ value, onChange, disabled, rarities = [6,5,4,3,2,1] }: FilterProps & { rarities?: readonly number[] }) {
  const intl = useTranslations();

  return <Tabs className="min-w-0 shrink-0" value={value} onValueChange={onChange}>
    <TabsList aria-label={intl("components_operators_OperatorPickerParts.filterByRarity")} className="max-w-full justify-start overflow-x-auto overflow-y-hidden">
      <TabsTrigger value="all" disabled={disabled}>{intl("components_operators_OperatorPickerParts.all")}</TabsTrigger>
      {rarities.map((rarity) => <TabsTrigger key={rarity} value={String(rarity)} className="font-number" aria-label={intl("components_operators_OperatorPickerParts.starOperators", { rarity: rarity })} disabled={disabled}>{rarity}★</TabsTrigger>)}
    </TabsList>
  </Tabs>;
}

export function OperatorProfessionFilter({ value, onChange, disabled }: FilterProps) {
  const intl = useTranslations();
  const locale = useLocale();
  const en = locale === "en";
  return <Tabs className="min-w-0 shrink-0" value={value} onValueChange={onChange}>
    <TabsList aria-label={intl("components_operators_OperatorPickerParts.filterByProfession")}>
      <TabsTrigger value="all" disabled={disabled}>{intl("components_operators_OperatorPickerParts.all")}</TabsTrigger>
      {PROFESSIONS.map((profession) => <TabsTrigger key={profession} value={String(profession)} disabled={disabled}>{(en ? PROFESSION_LABELS_ENGLISH : PROFESSION_LABELS)[profession]}</TabsTrigger>)}
    </TabsList>
  </Tabs>;
}

export function OperatorRosterGrid({ children, compact = false, hasMore, onLoadMore }: { children: ReactNode; compact?: boolean; hasMore: boolean; onLoadMore: () => void }) {
  const locale = useLocale();
  return <>
    <div className={cn("grid md:grid-cols-2", compact ? "gap-2" : "gap-3")}>{children}</div>
    <LoadMore auto={false} className={compact ? "min-h-9" : undefined} hasMore={hasMore} onLoad={() => { onLoadMore(); return true; }} labels={messageRecord(locale, "components_operators_OperatorPickerParts_labels")} />
  </>;
}
