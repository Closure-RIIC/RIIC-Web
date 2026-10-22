"use client";
import { useTranslations, useLocale } from "use-intl";

import { useDeferredValue, useState } from "react";
import { Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { SetupActionButton } from "@/components/setup/SetupActionButton";
import { OperatorIdentity, OperatorSearch, OperatorRarityFilter, OperatorProfessionFilter, OperatorRosterGrid, OPERATOR_PAGE_SIZE } from "@/components/operators/OperatorPickerParts";
import { localizedOperatorName } from "@/i18n/game-data";
import { useGameCatalog } from "@/i18n/game-data-client";
import { eligibleMasteryTargets, MASTERY_UNSUPPORTED_TARGET_IDS } from "@/mastery";
import { PROFESSION_LABELS, PROFESSION_LABELS_ENGLISH } from "@/operator-presentation";
import catalog from "@riic/arknights-domain/generated/arkntools/operator-catalog.json";
import { cn } from "@/lib/utils";
import type { OperBoxEntry } from "@riic/arknights-domain/types";

const byId = new Map(catalog.map((o) => [o.id,o]));
const unsupportedIds = new Set<string>(MASTERY_UNSUPPORTED_TARGET_IDS);
export function MasteryTargetPicker({ operbox, selectedId, onSelect, onClose }: {
  operbox: readonly OperBoxEntry[]; selectedId: string | null; onSelect: (id: string) => void; onClose: () => void;
}) {
  const intl = useTranslations();
  const locale = useLocale();
  const gameCatalog = useGameCatalog();
  const en = locale === "en";
  const [selected, setSelected] = useState(selectedId);
  const [query, setQuery] = useState("");
  const [rarity, setRarity] = useState("all");
  const [profession, setProfession] = useState("all");
  const [limit, setLimit] = useState(OPERATOR_PAGE_SIZE);
  const deferred = useDeferredValue(query.trim().toLocaleLowerCase());
  const eligible = eligibleMasteryTargets(operbox);
  const unsupported = operbox.filter((o) => o.own && o.elite === 2 && unsupportedIds.has(o.id));
  const filtered = eligible.filter((o) => {
    const meta = byId.get(o.id)!;
    return (rarity === "all" || o.rarity === Number(rarity)) && (profession === "all" || meta.profession === Number(profession))
      && (!deferred || [o.name,o.id,localizedOperatorName(o.name,locale,gameCatalog)].some((name) => name.toLocaleLowerCase().includes(deferred)));
  }).sort((a,b) => b.rarity - a.rarity || byId.get(b.id)!.order - byId.get(a.id)!.order);
  const unsupportedFiltered = unsupported.filter((o) => {
    const meta = byId.get(o.id);
    return meta && (rarity === "all" || o.rarity === Number(rarity)) && (profession === "all" || meta.profession === Number(profession))
      && (!deferred || [o.name, o.id, localizedOperatorName(o.name, locale, gameCatalog)].some((name) => name.toLocaleLowerCase().includes(deferred)));
  });
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent fromSkeleton className="max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-[min(880px,calc(100vw-2rem))]" data-mastery-target-picker>
      <DialogHeader>
        <DialogTitle>{intl("components_mastery_MasteryTargetPicker.chooseATrainee")}</DialogTitle>
        <DialogDescription>{intl("components_mastery_MasteryTargetPicker.ownedE2OperatorsInYourCurrentBoxThisSelection", { length: eligible.length })}</DialogDescription>
      </DialogHeader>
      <DialogBody className="min-h-0 overflow-y-auto pb-5">
        <OperatorSearch value={query} onChange={(value) => { setQuery(value); setLimit(OPERATOR_PAGE_SIZE); }} />
        <div className="flex min-w-0 flex-wrap gap-2">
          <div data-yeye-scroll="auto" className="max-w-full overflow-x-auto"><OperatorRarityFilter value={rarity} rarities={[6,5,4]} onChange={(value) => { setRarity(value); setLimit(OPERATOR_PAGE_SIZE); }} /></div>
          <div data-yeye-scroll="auto" className="max-w-full overflow-x-auto"><OperatorProfessionFilter value={profession} onChange={(value) => { setProfession(value); setLimit(OPERATOR_PAGE_SIZE); }} /></div>
        </div>
        {filtered.length || unsupportedFiltered.length ? <OperatorRosterGrid hasMore={limit < filtered.length} onLoadMore={() => setLimit((value) => value + OPERATOR_PAGE_SIZE)}>
          {filtered.slice(0,limit).map((o) => <button key={o.id} type="button" aria-label={intl("components_mastery_MasteryTargetPicker.select", { value1: (en) ? (localizedOperatorName(o.name,locale,gameCatalog)) : "", name: (en) ? "" : (o.name) })} aria-pressed={selected === o.id}
            onClick={() => setSelected(o.id)} className={cn("flex min-w-0 items-center gap-3 rounded-[4px] border bg-background p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring", selected === o.id ? "border-primary ring-1 ring-primary" : "border-border hover:bg-muted")}>
            <OperatorIdentity name={o.name} portrait={byId.get(o.id)?.portrait}>
              <span className="font-number text-xs text-muted-foreground">{o.rarity}★ · {intl("components_mastery_MasteryTargetPicker.e2")} · {(en ? PROFESSION_LABELS_ENGLISH : PROFESSION_LABELS)[byId.get(o.id)!.profession]}</span>
            </OperatorIdentity>
            {selected === o.id ? <Check className="ml-auto size-4 shrink-0" aria-hidden="true" /> : null}
          </button>)}
          {unsupportedFiltered.map((o) => <button key={o.id} type="button" disabled className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] items-center gap-3 rounded-[4px] border border-border bg-muted/50 p-3 text-left opacity-65">
            <span className="flex min-w-0 items-center gap-3">
              <OperatorIdentity name={o.name} portrait={byId.get(o.id)?.portrait}>
                <span className="font-number text-xs text-muted-foreground">{o.rarity}★ · {intl("components_mastery_MasteryTargetPicker.e2")} · {en ? PROFESSION_LABELS_ENGLISH[byId.get(o.id)!.profession] : PROFESSION_LABELS[byId.get(o.id)!.profession]}</span>
              </OperatorIdentity>
            </span>
            <span className="min-w-0 text-center text-balance text-xs leading-5 text-muted-foreground">{en ? "Train this Special Operations operator in the specified Integrated Strategies mode" : "需要在指定的集成战略模式中进行特勤干员培训"}</span>
          </button>)}
        </OperatorRosterGrid> : <p className="py-10 text-center text-sm text-muted-foreground">{intl("components_mastery_MasteryTargetPicker.noMatchingOwnedE2Operators")}</p>}
      </DialogBody>
      <DialogFooter>
        <SetupActionButton variant="outline" onClick={onClose}>{intl("components_mastery_MasteryTargetPicker.cancel")}</SetupActionButton>
        <SetupActionButton disabled={!eligible.some((o) => o.id === selected)} onClick={() => { if (selected) onSelect(selected); }}>{intl("components_mastery_MasteryTargetPicker.useThisOperator")}</SetupActionButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
