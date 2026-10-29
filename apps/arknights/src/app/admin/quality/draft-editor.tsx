"use client";
import { useTranslations } from "use-intl";

import { Link } from "@tanstack/react-router";
import { Download, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ManualOperboxPicker } from "@/components/setup/ManualOperboxPicker";
import { RotationSettings } from "@/components/RotationSettings";
import { PRESETS, maxRoomLevel, updateRoomLevel, updateFactoryRecipe, updateTradeOrder, factoryRecipeFor, tradeOrderFor } from "@riic/arknights-domain/blueprint";
import { rotationDescription } from "@riic/arknights-domain/rotation-settings";
import { reproductionInputKey, type ReproductionPackage } from "@riic/arknights-domain/reproduction-package";
import type { QualityDraftData } from "@riic/arknights-domain/quality";
import { Check, Choice, download, Panel, useWorkbenchText } from "./workbench-ui";

export function DraftEditor({ draft, input, setInput, busy, onSave }: { draft: QualityDraftData; input: ReproductionPackage; setInput: (input: ReproductionPackage) => void; busy: boolean; onSave: () => void }) {
  const { en } = useWorkbenchText();
  const t = useTranslations("QualityWorkbench");
  const dirty = reproductionInputKey(input) !== reproductionInputKey(draft.input);
  const changed = reproductionInputKey(input) !== reproductionInputKey(draft.original);
  const names: Record<string, string> = { control_center: t("controlCenter"), power_plant: t("powerPlant"), factory: t("factory"), trade_post: t("tradingPost"), dormitory: t("dormitory"), meeting_room: t("reception"), office: t("office"), workshop: t("workshop"), training_room: t("trainingRoom") };
  const products = [{ value: "all", label: t("allProducts") }, { value: "gold", label: t("preciousMetals") }, { value: "battle_record", label: t("battleRecords") }, { value: "originium", label: t("originiumShards") }];
  const originalOperators = new Map(draft.original.operbox.map(operator => [operator.id, operator]));
  const changedOperators = input.operbox.filter(operator => Object.entries(operator).some(([key, value]) => originalOperators.get(operator.id)?.[key as keyof typeof operator] !== value)).map(operator => operator.name);
  const removedOperators = draft.original.operbox.filter(operator => !input.operbox.some(current => current.id === operator.id)).map(operator => operator.name);

  return <Panel id="draft-editor" title={t("editReproductionDraft")} description={t("changesApplyOnlyToTeamTestsYourPersonal")}>
    <div className="flex flex-wrap items-center gap-2"><Badge variant={dirty ? "outline" : "secondary"}>{dirty ? t("unsavedChanges") : t("savedRevision", { value1: draft.revision })}</Badge><span className="text-xs text-muted-foreground">{changed ? t("changedFromOriginal") : t("matchesOriginal")}</span></div>
    <p className="break-words text-sm">{draft.sources.map(source => source.name).join(" · ")}</p>
    <fieldset disabled={busy} className="grid min-w-0 gap-4 disabled:opacity-60">
      <Choice label={t("layoutPreset")} value={input.layout.template} options={[...(!PRESETS.some(p => p.label === input.layout.template) ? [{ value: input.layout.template, label: input.layout.template }] : []), ...PRESETS.map(p => ({ value: p.label, label: p.label }))]} onChange={value => { const preset = PRESETS.find(p => p.label === value); if (preset) setInput({ ...input, layout: structuredClone(preset.layout) }); }} />
      <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">{t("roomLevelsAndProductionRooms", { value1: input.layout.rooms.length })}</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">{input.layout.rooms.map(room => <div key={room.id} className="grid gap-2 rounded-lg bg-muted/40 p-3">
          <label className="grid gap-2 text-sm">{names[room.kind] ?? room.kind} · {room.id}<span className="flex items-center gap-3"><span className="text-muted-foreground">{t("level")}</span><Input aria-label={`${names[room.kind] ?? room.kind} ${room.id} ${t("level")}`} className="w-20" type="number" min={1} max={maxRoomLevel(room.kind)} value={room.level} onChange={e => { const value = Number(e.target.value); if (Number.isFinite(value)) setInput({ ...input, layout: updateRoomLevel(input.layout, room.id, value) }); }} /></span></label>
          {room.kind === "factory" && <Choice label={t("product")} value={factoryRecipeFor(room)} options={products} onChange={value => setInput({ ...input, layout: updateFactoryRecipe(input.layout, room.id, value as "all" | "gold" | "battle_record" | "originium") })} />}
          {room.kind === "trade_post" && <Choice label={t("orderType")} value={tradeOrderFor(room)} options={[{ value: "gold", label: t("lmdOrders") }, { value: "originium", label: t("orundumOrders") }]} onChange={value => setInput({ ...input, layout: updateTradeOrder(input.layout, room.id, value as "gold" | "originium") })} />}
        </div>)}</div>
      </details>
      <RotationSettings value={input.rotation} onChange={rotation => setInput({ ...input, rotation })} />
      <Check label={t("enableFiammettaMoraleRecovery")} checked={input.fiammetta_enable} onChange={value => setInput({ ...input, fiammetta_enable: value })} />
      <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">{t("operatorsAndLevelsOperators", { value1: input.operbox.length })}</summary><div className="mt-3"><ManualOperboxPicker operbox={input.operbox} onApply={operbox => setInput({ ...input, operbox })} compact /></div></details>
    </fieldset>
    {changed && <div className="grid gap-2 rounded-lg bg-muted/50 p-3 text-sm"><h3 className="font-medium">{t("changesFromTheOriginalInput")}</h3><ul className="list-inside list-disc space-y-1 text-muted-foreground">
      {JSON.stringify(input.layout) !== JSON.stringify(draft.original.layout) && <li>{t("layoutOrRoomSettingsChanged")}</li>}
      {input.rotation !== draft.original.rotation && <li>{rotationDescription(draft.original.rotation, en)} → {rotationDescription(input.rotation, en)}</li>}
      {input.fiammetta_enable !== draft.original.fiammetta_enable && <li>{input.fiammetta_enable ? t("fiammettaEnabled") : t("fiammettaDisabled")}</li>}
      {!!changedOperators.length && <li>{t("addedOrChanged")}{changedOperators.join("、")}</li>}
      {!!removedOperators.length && <li>{t("removed")}{removedOperators.join("、")}</li>}
    </ul><details><summary className="cursor-pointer">{t("viewFullInputComparison")}</summary><div className="mt-2 grid min-w-0 gap-3 md:grid-cols-2">{[[t("original"), draft.original], [t("current"), input]].map(([label, value]) => <div className="min-w-0" key={String(label)}><h4>{String(label)}</h4><div data-yeye-scroll="auto" className="max-h-64 overflow-auto whitespace-pre rounded border p-2 text-xs"><pre className="m-0 whitespace-[inherit]">{JSON.stringify(value, null, 2)}</pre></div></div>)}</div></details></div>}
    <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={onSave}><Save aria-hidden="true" />{t("saveAndSelectDraft")}</Button>{dirty && <Button variant="outline" disabled={busy} onClick={() => setInput(structuredClone(draft.input))}>{t("discardUnsavedChanges")}</Button>}<Button variant="ghost" disabled={busy || !changed} onClick={() => setInput(structuredClone(draft.original))}><RotateCcw aria-hidden="true" />{t("restoreOriginalInput")}</Button><Button variant="ghost" onClick={() => download("reproduction.json", input)}><Download aria-hidden="true" />{t("exportReproduction")}</Button></div>
    {draft.sources.filter(source => source.feedbackId).map(source => <Link className="text-sm underline underline-offset-4" key={source.feedbackId} to="/admin/issues" search={{ q: encodeURIComponent(source.feedbackId!) }}>{t("backToSourceFeedback")} · {source.name}</Link>)}
  </Panel>;
}
