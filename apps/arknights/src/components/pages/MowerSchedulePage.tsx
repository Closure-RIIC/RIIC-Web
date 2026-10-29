"use client";

import { createLocalizer as createUiLocalizer } from "@riic/arknights-domain/i18n/localize";
import type UiMessages from "../../../messages/zh-CN/AK_components_pages_MowerSchedulePage.json";
const uiText = createUiLocalizer<typeof UiMessages>("AK_components_pages_MowerSchedulePage");


import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "use-intl";
import { ArrowDown, ArrowUp, Bot, Check, Download, FileJson, GitBranch, Pencil, Plus, Search, Settings2, Trash2, Upload, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OperatorSlot, ScheduleBoard } from "@/components";
import { addOperatorPresentations } from "@/schedule-presentation";
import { mowerSchedulePresentation } from "@/mower-schedule-presentation";
import { OperatorIdentity, OperatorRarityFilter, OperatorRosterGrid, OperatorSearch } from "@/components/operators/OperatorPickerParts";

import { downloadJson } from "@/download";
import { cn } from "@/lib/utils";
import { createMowerEditorDocument, MOWER_EDITOR_STORAGE_KEY, MOWER_FIXED_ROOMS, parseMowerEditorDocument, type MowerEditorDocument } from "@/mower-editor";
import type { MowerFacility } from "@/mower-plan";
import { OPERATOR_CATALOG, operatorPresentationFor } from "@/operatorPortraits";
import type { RoomRow } from "@/schedule";
import type { OperBoxEntry } from "@riic/arknights-domain/types";

const FIELD_CLASS = "h-9 border-border bg-background";
const SELECT_CLASS = "h-9 min-w-0 border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

function capacityFor(key: string, name?: string): number {
  if (key.startsWith("room_")) return name === "发电站" ? 1 : 3;
  return MOWER_FIXED_ROOMS.find((room) => room.key === key)?.capacity ?? 1;
}

function roomTone(name?: string): string {
  if (name === "贸易站") return "infra-room-surface border-[#22BBFF]/55 bg-[#272A2B] text-[#22BBFF]";
  if (name === "制造站") return "infra-room-surface border-[#FFD800]/55 bg-[#272A2B] text-[#FFD800]";
  if (name === "发电站") return "infra-room-surface border-[#72D7A2]/55 bg-[#272A2B] text-[#72D7A2]";
  return "infra-room-surface border-white/10 bg-[#272A2B] text-white/80";
}

function Portrait({ name }: { name: string }) {
  if (!name || name === "Free") return <span className="grid size-10 shrink-0 place-items-center rounded-[3px] border border-current/15"><Plus className="size-4 opacity-30" /></span>;
  const presentation = operatorPresentationFor({ name });
  const slot = { name, label: name, portrait: presentation.portrait, profession: presentation.operator?.profession } as RoomRow["operatorSlots"][number];
  return <OperatorSlot slot={slot} portraitSize={48} selectionMode tooltipDisabled />;
}

function MowerOperatorPicker({ label, selected, operators, onChange }: {
  label: string;
  selected: string[];
  operators: OperBoxEntry[];
  onChange: (names: string[]) => void;
}) {
  const en = useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rarity, setRarity] = useState("all");
  const selectedSet = new Set(selected);
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const filtered = operators.filter((operator) => (
    (rarity === "all" || operator.rarity === Number(rarity))
    && (!normalizedQuery || operator.name.toLocaleLowerCase("zh-CN").includes(normalizedQuery) || operator.id.toLocaleLowerCase("en-US").includes(normalizedQuery))
  ));
  const toggle = (name: string) => onChange(selectedSet.has(name) ? selected.filter((item) => item !== name) : [...selected, name]);
  return (
    <>
      <button type="button" className="flex min-h-9 w-full min-w-0 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 py-1 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50" onClick={() => setOpen(true)} aria-label={label}>
        {selected.length ? selected.map((name) => <span key={name} className="inline-flex max-w-full items-center rounded-[3px] border border-border bg-muted px-1.5 py-0.5 text-xs"><span className="max-w-40 truncate">{name}</span></span>) : <span className="text-muted-foreground">{uiText.text(en, "chooseOperators")}</span>}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90svh] sm:max-w-[min(860px,calc(100vw-2rem))]">
          <DialogHeader><DialogTitle>{label}</DialogTitle><DialogDescription>{uiText.text(en, "selectFromTheCurrentBoxClickASelectedOperatorAgainToRemoveIt")}</DialogDescription></DialogHeader>
          <DialogBody className="min-h-0 overflow-auto">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"><OperatorSearch value={query} onChange={setQuery} compact label={uiText.text(en, "searchCurrentBox")} placeholder={uiText.text(en, "searchOperators")} /><OperatorRarityFilter value={rarity} onChange={setRarity} /></div>
            <OperatorRosterGrid compact hasMore={false} onLoadMore={() => undefined}>
              {filtered.map((operator) => <button key={operator.id} type="button" className={cn("flex min-w-0 items-center gap-3 rounded-[4px] border p-2 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-[#FFD800]", selectedSet.has(operator.name) ? "border-[#FFD800] bg-[#FFD800]/10" : "border-border/70")} onClick={() => toggle(operator.name)} aria-pressed={selectedSet.has(operator.name)}><OperatorIdentity name={operator.name} portrait={operatorPresentationFor({ name: operator.name }).portrait} compact><span className="font-number text-xs text-muted-foreground">{operator.rarity}★ · E{operator.elite}</span></OperatorIdentity>{selectedSet.has(operator.name) ? <Check className="ml-auto size-4 shrink-0 text-[#B18F00]" /> : null}</button>)}
            </OperatorRosterGrid>
          </DialogBody>
          <DialogFooter><Button onClick={() => setOpen(false)}><Check />{uiText.text(en, "done")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function MowerSchedulePage({ operbox = null }: { operbox?: OperBoxEntry[] | null }) {
  const en = useLocale();
  const [document, setDocument] = useState<MowerEditorDocument>(createMowerEditorDocument);
  const [restored, setRestored] = useState(false);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [editingRoom, setEditingRoom] = useState<string | null>(null);
  const [roomDraft, setRoomDraft] = useState<MowerFacility>({ plans: [] });
  const [editorMode, setEditorMode] = useState<"rename" | "trigger" | "task" | null>(null);
  const [editorValue, setEditorValue] = useState("");
  const [triggerTiming, setTriggerTiming] = useState("AFTER_PLANNING");
  const [editorError, setEditorError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [scheduleQuery, setScheduleQuery] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const backup = active >= 0 ? document.backup_plans[active] : undefined;
  const currentPlan = backup?.plan ?? document.plan1;
  const currentConf = backup?.conf ?? document.conf;
  const boxOperators = (operbox ?? []).filter((operator) => operator.own);
  const board = useMemo(() => {
    const view = mowerSchedulePresentation(currentPlan);
    return { ...view, rows: addOperatorPresentations(view.rows) };
  }, [currentPlan]);
  const eliteByOperator = new Map(boxOperators.map((operator) => [operator.name, operator.elite]));
  const levelByOperator = new Map(boxOperators.map((operator) => [operator.name, operator.level]));

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(MOWER_EDITOR_STORAGE_KEY);
      if (stored) setDocument(parseMowerEditorDocument(stored));
      setRestored(true);
    } catch {
      setError("@mower:restoreFailed");
    }
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      window.localStorage.setItem(MOWER_EDITOR_STORAGE_KEY, JSON.stringify(document));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }, [document, restored]);

  function updateFacility(key: string, facility: MowerFacility) {
    setDocument((current) => {
      const next = structuredClone(current);
      const plan = active >= 0 ? next.backup_plans[active]?.plan : next.plan1;
      if (plan) plan[key] = facility;
      return next;
    });
  }

  function openRoom(key: string, name: string) {
    setEditingRoom(key);
    setRoomDraft(structuredClone(currentPlan[key] ?? { name, plans: [] }));
  }

  function changeConf(key: string, value: string | number) {
    setDocument((current) => {
      const next = structuredClone(current);
      if (active >= 0 && next.backup_plans[active]) next.backup_plans[active]!.conf[key] = value;
      else Object.assign(next.conf, { [key]: value });
      return next;
    });
  }

  function addBackup() {
    const nextIndex = document.backup_plans.length;
    setDocument((current) => ({
      ...current,
      backup_plans: [...current.backup_plans, {
        name: `${uiText.text(en, "backup")} ${nextIndex + 1}`,
        plan: structuredClone(currentPlan),
        conf: {},
        task: {},
        trigger: { left: "", operator: "", right: "" },
        trigger_timing: "AFTER_PLANNING",
      }],
    }));
    setActive(nextIndex);
  }

  function moveBackup(direction: number) {
    const target = active + direction;
    if (active < 0 || target < 0 || target >= document.backup_plans.length) return;
    setDocument((current) => {
      const next = structuredClone(current);
      [next.backup_plans[active], next.backup_plans[target]] = [next.backup_plans[target]!, next.backup_plans[active]!];
      return next;
    });
    setActive(target);
  }

  function openEditor(mode: "rename" | "trigger" | "task") {
    if (!backup) return;
    setEditorMode(mode);
    setTriggerTiming(backup.trigger_timing);
    setEditorError(null);
    setEditorValue(mode === "rename" ? backup.name : JSON.stringify(backup[mode], null, 2));
  }

  function saveEditor() {
    if (!editorMode || active < 0) return;
    try {
      const value: unknown = editorMode === "rename" ? editorValue.trim() : JSON.parse(editorValue);
      if (editorMode === "rename" ? !value : !value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
      if (editorMode === "task" && Object.values(value as Record<string, unknown>).some((entry) => entry !== null && (!Array.isArray(entry) || entry.some((name) => typeof name !== "string")))) throw new Error("invalid");
      setDocument((current) => {
        const next = structuredClone(current);
        const selected = next.backup_plans[active];
        if (selected) {
          Object.assign(selected, { [editorMode === "rename" ? "name" : editorMode]: value });
          if (editorMode === "trigger") selected.trigger_timing = triggerTiming;
        }
        return next;
      });
      setEditorMode(null);
    } catch {
      setEditorError(uiText.text(en, "invalidContentCheckTheFormatBeforeSaving"));
    }
  }

  async function importFile(file: File) {
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("too large");
      const imported = parseMowerEditorDocument(await file.text());
      setDocument(imported);
      setRestored(true);
      setActive(-1);
      setError(null);
    } catch {
      setError(uiText.text(en, "chooseAValidMowerPlanJsonFileSmallerThan5MB"));
    }
  }

  function renderRoom(key: string, title: string) {
    const room = currentPlan[key];
    const name = room?.name || title;
    const occupants = room?.plans ?? [];
    const label = key.startsWith("room_") ? `${name} B${key.split("_")[1]}0${key.split("_")[2]}` : title;
    return (
      <button key={key} type="button" onClick={() => openRoom(key, name)} aria-label={`${uiText.text(en, "edit")}${label}`} data-mower-room={key}
        className={cn("flex h-[92px] min-w-0 flex-col items-center justify-center gap-2 rounded-[4px] border px-2 transition-shadow hover:ring-2 hover:ring-blue-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500", roomTone(room?.name))}>
        <span className="flex max-w-full items-center gap-2 text-[13px] font-medium"><span className="truncate">{key.startsWith("room_") ? name : title}</span>{key.startsWith("room_") ? <span className="text-[10px] font-normal opacity-55">B{key.split("_")[1]}0{key.split("_")[2]}</span> : null}</span>
        <span className="flex max-w-full items-center justify-center gap-1.5">
          {occupants.length ? occupants.slice(0, capacityFor(key, name)).map((operator, index) => <Portrait key={index} name={operator.agent} />) : <span className="grid h-10 w-10 place-items-center rounded-[3px] border border-dashed border-current/20"><Plus className="size-4 opacity-40" /></span>}
        </span>
      </button>
    );
  }

  return (
    <div className="min-h-[calc(100svh-9rem)] min-w-0 py-2" data-mower-schedule-page>
      <header className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 basis-full md:flex-1 md:basis-auto">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9 max-md:h-11" value={scheduleQuery} onChange={(event) => setScheduleQuery(event.target.value)}
            aria-label={uiText.text(en, "searchMowerSchedule")} placeholder={uiText.text(en, "searchOperatorsOrFacilities")} />
        </div>
        <Button variant="outline" size="sm" onClick={() => setDetailsOpen(true)}><Settings2 />{uiText.text(en, "planDetails")}</Button>
        <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}><Upload />{uiText.text(en, "importPlan")}</Button>
        <Button size="sm" onClick={() => downloadJson("plan.json", document)}><Download />{uiText.text(en, "downloadPlan")}</Button>
        <input ref={fileInput} type="file" accept="application/json,.json" className="sr-only" aria-label={uiText.text(en, "chooseMowerPlanFile")} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void importFile(file); event.currentTarget.value = ""; }} />
      </header>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-y border-border/70 bg-muted/25 px-3 py-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-sm font-medium"><Bot className="size-4 shrink-0" /><span className="truncate">{document.title || uiText.text(en, "mowerSchedule")}</span><span className="font-number text-muted-foreground">Mower</span></h1>
          <p className="mt-1 text-xs text-muted-foreground">{backup?.name ?? uiText.text(en, "mainPlan")} · {uiText.text(en, "currentBox")} {boxOperators.length} {uiText.text(en, "operators")}</p>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status"><Check className="size-3.5" />{saved ? uiText.text(en, "savedLocally") : uiText.text(en, "localDraft")}</span>
      </div>
      {error ? <p role="alert" className="mb-3 text-sm text-destructive">{error === "@mower:restoreFailed" ? uiText.text(en, "theSavedMowerPlanCouldNotBeRestored") : error}</p> : null}

      <div className="mb-3 flex flex-wrap items-center gap-2" data-mower-plan-toolbar>
        <Button variant="outline" size="sm" onClick={addBackup}><Plus />{uiText.text(en, "newBackup")}</Button>
        <Button size="icon-sm" variant="outline" disabled={!backup} onClick={() => openEditor("rename")} aria-label={uiText.text(en, "rename")}><Pencil /></Button>
        <Button size="icon-sm" variant="outline" disabled={active <= 0} onClick={() => moveBackup(-1)} aria-label={uiText.text(en, "moveUp")}><ArrowUp /></Button>
        <Button size="icon-sm" variant="outline" disabled={active < 0 || active >= document.backup_plans.length - 1} onClick={() => moveBackup(1)} aria-label={uiText.text(en, "moveDown")}><ArrowDown /></Button>
        <Button variant="outline" size="sm" disabled={!backup} onClick={() => openEditor("trigger")}><GitBranch />{uiText.text(en, "editTrigger")}</Button>
        <Button variant="outline" size="sm" disabled={!backup} onClick={() => openEditor("task")}><FileJson />{uiText.text(en, "editTask")}</Button>
        <Button size="icon-sm" variant="destructive" disabled={!backup} onClick={() => setDeleteOpen(true)} aria-label={uiText.text(en, "deleteBackup")}><Trash2 /></Button>
      </div>
      <ScheduleBoard
        rows={board.rows} layout={board.layout} activeShift={active + 1} planRevision={`mower-${active}`}
        roomProducts={board.products}
        eliteByOperator={eliteByOperator} levelByOperator={levelByOperator} searchQuery={scheduleQuery}
        shiftTabsSlot={(
          <Tabs value={String(active)} onValueChange={(value) => setActive(Number(value))} className="min-w-0 max-w-full">
            <TabsList className="h-auto max-w-full flex-wrap justify-start" aria-label={uiText.text(en, "selectPlan")}>
              <TabsTrigger value="-1" className="px-3">{uiText.text(en, "mainPlan")}</TabsTrigger>
              {document.backup_plans.map((plan, index) => <TabsTrigger key={index} value={String(index)} className="max-w-48 px-3"><span className="truncate">{plan.name}</span></TabsTrigger>)}
            </TabsList>
          </Tabs>
        )}
        onSlotClick={(row) => openRoom(row.roomId, currentPlan[row.roomId]?.name || (row.roomId.startsWith("room_") ? "制造站" : row.groupLabel))}
        onFactoryRecipeChange={(roomId, recipe) => updateFacility(roomId, { ...currentPlan[roomId], name: "制造站", product: recipe === "battle_record" ? "exp3" : recipe === "originium" ? "orirock" : "gold" })}
        onTradeOrderChange={(roomId, order) => updateFacility(roomId, { ...currentPlan[roomId], name: "贸易站", product: order === "originium" ? "orundum" : "lmd" })}
        renderListRoomActions={(row, position) => position === "header" ? (
          <Button variant="outline" size="icon-sm" aria-label={`${uiText.text(en, "edit")}${row.title}`} onClick={() => openRoom(row.roomId, currentPlan[row.roomId]?.name || (row.roomId.startsWith("room_") ? "制造站" : row.groupLabel))}><Pencil /></Button>
        ) : null}
      />
      {["gaming_1", "gaming_2", "gaming_3"].some((key) => currentPlan[key]) ? <section className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">{["gaming_1", "gaming_2", "gaming_3"].filter((key) => currentPlan[key]).map((key) => renderRoom(key, `${uiText.text(en, "activityRoom")} ${key.split("_")[1]}`))}</section> : null}

      <details className="mt-5 border-y border-border/70 bg-muted/15 px-3 py-3 sm:px-4" data-mower-rules>
        <summary className="cursor-pointer text-sm font-medium">{uiText.text(en, "moraleAndSchedulingRules")}</summary>
      <section className="grid gap-3 border-t border-border/70 pt-5">
        <div className="grid gap-3 sm:grid-cols-[210px_minmax(0,1fr)] sm:items-center"><span className="text-sm">{uiText.text(en, "lingDuskMode")}</span><div className="flex flex-wrap gap-x-6 gap-y-2">{[[1, "perception"], [2, "worldly"], [3, "balanced"]].map(([value, label]) => <label key={value} className="flex items-center gap-2 text-sm"><input type="radio" name="mower-ling-xi" value={value} checked={Number(currentConf.ling_xi ?? 1) === value} onChange={() => changeConf("ling_xi", Number(value))} className="size-4 accent-blue-600" />{uiText.text(en, label as keyof typeof UiMessages)}</label>)}</div></div>
        {[["rest_in_full", "restToFullMorale"], ["exhaust_require", "workToExhaustion"], ["workaholic", "workAtZeroMorale"], ["resting_priority", "lowRestPriority"], ["ope_resting_priority", "restingOrderPriority"], ["refresh_trading", "refreshTradingTimers"], ["refresh_drained", "refreshExhaustionTimers"]].map(([key, label]) => <label key={key} className="grid gap-2 text-sm sm:grid-cols-[210px_minmax(0,1fr)] sm:items-center"><span>{uiText.text(en, label as keyof typeof UiMessages)}</span><MowerOperatorPicker label={uiText.text(en, label as keyof typeof UiMessages)} selected={String(currentConf[key as keyof typeof currentConf] ?? "").split(",").map((name) => name.trim()).filter(Boolean)} operators={boxOperators} onChange={(names) => changeConf(key!, names.join(","))} /></label>)}
      </section>

      </details>

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-h-[calc(100svh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-xl">
          <DialogHeader><DialogTitle>{uiText.text(en, "planDetails")}</DialogTitle><DialogDescription>{uiText.text(en, "theTitleAuthorAndNotesAreSavedWithThePlanFile")}</DialogDescription></DialogHeader>
          <DialogBody className="min-h-0 overflow-y-auto">
            <label className="grid gap-2 text-sm">{uiText.text(en, "title")}<Input value={document.title} onChange={(event) => setDocument({ ...document, title: event.target.value })} /></label>
            <label className="grid gap-2 text-sm">{uiText.text(en, "author")}<Input value={document.author} onChange={(event) => setDocument({ ...document, author: event.target.value })} /></label>
            <label className="grid gap-2 text-sm">{uiText.text(en, "planID")}<Input value={document.id} onChange={(event) => setDocument({ ...document, id: event.target.value })} /></label>
            <label className="grid gap-2 text-sm">{uiText.text(en, "notes")}<Textarea className="min-h-28" value={document.description} onChange={(event) => setDocument({ ...document, description: event.target.value })} /></label>
          </DialogBody>
          <DialogFooter><Button onClick={() => setDetailsOpen(false)}><Check />{uiText.text(en, "done")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingRoom)} onOpenChange={(open) => { if (!open) setEditingRoom(null); }}>
        <DialogContent className="max-h-[90svh] sm:max-w-[min(800px,calc(100vw-2rem))]">
          <DialogHeader><DialogTitle>{uiText.text(en, "editFacility")} · {editingRoom}</DialogTitle><DialogDescription>{roomDraft.name}</DialogDescription></DialogHeader>
          <DialogBody className="max-h-[60svh] overflow-auto">
            {editingRoom?.startsWith("room_") ? <div className="flex flex-wrap gap-3"><select className={SELECT_CLASS} aria-label={uiText.text(en, "facilityType")} value={roomDraft.name ?? "制造站"} onChange={(event) => setRoomDraft({ ...roomDraft, name: event.target.value, product: event.target.value === "贸易站" ? "lmd" : event.target.value === "制造站" ? "gold" : undefined })}><option value="贸易站">{uiText.text(en, "tradingPost")}</option><option value="制造站">{uiText.text(en, "factory")}</option><option value="发电站">{uiText.text(en, "powerPlant")}</option></select>{roomDraft.name !== "发电站" ? <select className={SELECT_CLASS} aria-label={uiText.text(en, "product")} value={roomDraft.product ?? (roomDraft.name === "贸易站" ? "lmd" : "gold")} onChange={(event) => setRoomDraft({ ...roomDraft, product: event.target.value })}>{(roomDraft.name === "贸易站" ? [["lmd", "lmd"], ["orundum", "orundum"]] : [["gold", "gold"], ["exp3", "battleRecord"], ["orirock", "originiumShard"]]).map(([value, label]) => <option key={value} value={value}>{uiText.text(en, label as keyof typeof UiMessages)}</option>)}</select> : null}</div> : null}
            <div className="space-y-3">{(roomDraft.plans ?? []).map((operator, index) => <div key={index} className="grid grid-cols-[40px_minmax(0,1fr)_32px] items-start gap-2 border-b border-border/60 pb-3"><Portrait name={operator.agent} /><div className="grid gap-2 sm:grid-cols-2"><Input className={FIELD_CLASS} list="mower-operator-names" value={operator.agent} aria-label={`${uiText.text(en, "operator")} ${index + 1}`} onChange={(event) => setRoomDraft({ ...roomDraft, plans: roomDraft.plans?.map((entry, position) => position === index ? { ...entry, agent: event.target.value } : entry) })} /><Input className={FIELD_CLASS} value={operator.group ?? ""} placeholder={uiText.text(en, "group")} aria-label={`${uiText.text(en, "group")} ${index + 1}`} onChange={(event) => setRoomDraft({ ...roomDraft, plans: roomDraft.plans?.map((entry, position) => position === index ? { ...entry, group: event.target.value } : entry) })} /><Input className={cn(FIELD_CLASS, "sm:col-span-2")} value={(operator.replacement ?? []).join(", ")} placeholder={uiText.text(en, "replacementOperators")} aria-label={`${uiText.text(en, "replacements")} ${index + 1}`} onChange={(event) => setRoomDraft({ ...roomDraft, plans: roomDraft.plans?.map((entry, position) => position === index ? { ...entry, replacement: event.target.value.split(/[,，]/).map((name) => name.trim()) } : entry) })} /></div><Button variant="ghost" size="icon" onClick={() => setRoomDraft({ ...roomDraft, plans: roomDraft.plans?.filter((_, position) => position !== index) })} aria-label={uiText.text(en, "removeOperator")}><Trash2 /></Button></div>)}</div>
            <Button variant="outline" disabled={(roomDraft.plans?.length ?? 0) >= capacityFor(editingRoom ?? "", roomDraft.name)} onClick={() => setRoomDraft({ ...roomDraft, plans: [...(roomDraft.plans ?? []), { agent: "", group: "", replacement: [] }] })}><Users />{uiText.text(en, "addOperator")}</Button>
            <datalist id="mower-operator-names"><option value="Free" />{OPERATOR_CATALOG.map((operator) => <option key={operator.id} value={operator.name} />)}</datalist>
          </DialogBody>
          <DialogFooter><Button variant="ghost" onClick={() => setEditingRoom(null)}>{uiText.text(en, "cancel")}</Button><Button onClick={() => { if (editingRoom) updateFacility(editingRoom, { ...roomDraft, plans: (roomDraft.plans ?? []).filter((entry) => entry.agent.trim()).slice(0, capacityFor(editingRoom, roomDraft.name)).map((entry) => ({ ...entry, agent: entry.agent.trim(), replacement: (entry.replacement ?? []).filter(Boolean) })) }); setEditingRoom(null); }}><Check />{uiText.text(en, "save")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editorMode)} onOpenChange={(open) => { if (!open) setEditorMode(null); }}>
        <DialogContent className="sm:max-w-[min(660px,calc(100vw-2rem))]"><DialogHeader><DialogTitle>{editorMode === "rename" ? uiText.text(en, "renameBackup") : editorMode === "trigger" ? uiText.text(en, "editTrigger") : uiText.text(en, "editTask")}</DialogTitle><DialogDescription>{backup?.name}</DialogDescription></DialogHeader><DialogBody>{editorMode === "rename" ? <Input value={editorValue} onChange={(event) => setEditorValue(event.target.value)} aria-label={uiText.text(en, "backupName")} /> : <Textarea className="min-h-64 font-mono text-xs" value={editorValue} onChange={(event) => setEditorValue(event.target.value)} aria-label="JSON" />}{editorMode === "trigger" && backup ? <select className={SELECT_CLASS} value={triggerTiming} aria-label={uiText.text(en, "triggerTiming")} onChange={(event) => setTriggerTiming(event.target.value)}>{["BEGINNING", "BEFORE_PLANNING", "AFTER_PLANNING", "END"].map((timing) => <option key={timing}>{timing}</option>)}</select> : null}{editorError ? <p className="text-sm text-destructive" role="alert">{editorError}</p> : null}</DialogBody><DialogFooter><Button variant="ghost" onClick={() => setEditorMode(null)}>{uiText.text(en, "cancel")}</Button><Button onClick={saveEditor}><Check />{uiText.text(en, "save")}</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}><DialogContent><DialogHeader><DialogTitle>{uiText.text(en, "deleteBackupConfirm")}</DialogTitle><DialogDescription>{backup?.name}</DialogDescription></DialogHeader><DialogFooter><Button variant="ghost" onClick={() => setDeleteOpen(false)}>{uiText.text(en, "cancel")}</Button><Button variant="destructive" onClick={() => { setDocument((current) => ({ ...current, backup_plans: current.backup_plans.filter((_, index) => index !== active) })); setActive(-1); setDeleteOpen(false); }}><Trash2 />{uiText.text(en, "delete")}</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}
