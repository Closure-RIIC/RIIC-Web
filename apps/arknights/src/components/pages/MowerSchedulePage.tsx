"use client";

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

function MowerOperatorPicker({ label, selected, operators, onChange, text }: {
  label: string;
  selected: string[];
  operators: OperBoxEntry[];
  onChange: (names: string[]) => void;
  text: (zh: string, en: string) => string;
}) {
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
        {selected.length ? selected.map((name) => <span key={name} className="inline-flex max-w-full items-center rounded-[3px] border border-border bg-muted px-1.5 py-0.5 text-xs"><span className="max-w-40 truncate">{name}</span></span>) : <span className="text-muted-foreground">{text("选择干员", "Choose operators")}</span>}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90svh] sm:max-w-[min(860px,calc(100vw-2rem))]">
          <DialogHeader><DialogTitle>{label}</DialogTitle><DialogDescription>{text("从当前 Box 选择，可多选。再次点击已选干员取消选择。", "Select from the current Box. Click a selected operator again to remove it.")}</DialogDescription></DialogHeader>
          <DialogBody className="min-h-0 overflow-auto">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"><OperatorSearch value={query} onChange={setQuery} compact label={text("搜索当前 Box 干员", "Search current Box")} placeholder={text("搜索干员", "Search operators")} /><OperatorRarityFilter value={rarity} onChange={setRarity} /></div>
            <OperatorRosterGrid compact hasMore={false} onLoadMore={() => undefined}>
              {filtered.map((operator) => <button key={operator.id} type="button" className={cn("flex min-w-0 items-center gap-3 rounded-[4px] border p-2 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-[#FFD800]", selectedSet.has(operator.name) ? "border-[#FFD800] bg-[#FFD800]/10" : "border-border/70")} onClick={() => toggle(operator.name)} aria-pressed={selectedSet.has(operator.name)}><OperatorIdentity name={operator.name} portrait={operatorPresentationFor({ name: operator.name }).portrait} compact><span className="font-number text-xs text-muted-foreground">{operator.rarity}★ · E{operator.elite}</span></OperatorIdentity>{selectedSet.has(operator.name) ? <Check className="ml-auto size-4 shrink-0 text-[#B18F00]" /> : null}</button>)}
            </OperatorRosterGrid>
          </DialogBody>
          <DialogFooter><Button onClick={() => setOpen(false)}><Check />{text("完成", "Done")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function MowerSchedulePage({ operbox = null }: { operbox?: OperBoxEntry[] | null }) {
  const en = useLocale() === "en";
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
  const text = (zh: string, english: string) => en ? english : zh;
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
      setError(en ? "The saved Mower plan could not be restored." : "无法恢复本地 Mower 排班。可重新导入文件。");
    }
  }, [en]);

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
        name: `${text("副表", "Backup")} ${nextIndex + 1}`,
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
      setEditorError(text("内容格式不正确，请检查后保存。", "Invalid content. Check the format before saving."));
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
      setError(text("导入失败，请选择不超过 5 MB 的 Mower plan.json 文件。", "Choose a valid Mower plan.json file smaller than 5 MB."));
    }
  }

  function renderRoom(key: string, title: string) {
    const room = currentPlan[key];
    const name = room?.name || title;
    const occupants = room?.plans ?? [];
    const label = key.startsWith("room_") ? `${name} B${key.split("_")[1]}0${key.split("_")[2]}` : title;
    return (
      <button key={key} type="button" onClick={() => openRoom(key, name)} aria-label={`${text("编辑", "Edit ")}${label}`} data-mower-room={key}
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
            aria-label={text("搜索 Mower 排班", "Search Mower schedule")} placeholder={text("搜索干员或设施", "Search operators or facilities")} />
        </div>
        <Button variant="outline" size="sm" onClick={() => setDetailsOpen(true)}><Settings2 />{text("排班信息", "Plan details")}</Button>
        <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}><Upload />{text("导入排班文件", "Import plan")}</Button>
        <Button size="sm" onClick={() => downloadJson("plan.json", document)}><Download />{text("下载排班文件", "Download plan")}</Button>
        <input ref={fileInput} type="file" accept="application/json,.json" className="sr-only" aria-label={text("选择 Mower 排班文件", "Choose Mower plan file")} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void importFile(file); event.currentTarget.value = ""; }} />
      </header>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-y border-border/70 bg-muted/25 px-3 py-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-sm font-medium"><Bot className="size-4 shrink-0" /><span className="truncate">{document.title || text("排班表（Mower）", "Mower Schedule")}</span><span className="font-number text-muted-foreground">Mower</span></h1>
          <p className="mt-1 text-xs text-muted-foreground">{backup?.name ?? text("主表", "Main plan")} · {text("当前 Box", "Current Box")} {boxOperators.length} {text("名干员", "operators")}</p>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status"><Check className="size-3.5" />{saved ? text("已保存到本地", "Saved locally") : text("本地草稿", "Local draft")}</span>
      </div>
      {error ? <p role="alert" className="mb-3 text-sm text-destructive">{error}</p> : null}

      <div className="mb-3 flex flex-wrap items-center gap-2" data-mower-plan-toolbar>
        <Button variant="outline" size="sm" onClick={addBackup}><Plus />{text("新建副表", "New backup")}</Button>
        <Button size="icon-sm" variant="outline" disabled={!backup} onClick={() => openEditor("rename")} aria-label={text("重命名", "Rename")}><Pencil /></Button>
        <Button size="icon-sm" variant="outline" disabled={active <= 0} onClick={() => moveBackup(-1)} aria-label={text("上移", "Move up")}><ArrowUp /></Button>
        <Button size="icon-sm" variant="outline" disabled={active < 0 || active >= document.backup_plans.length - 1} onClick={() => moveBackup(1)} aria-label={text("下移", "Move down")}><ArrowDown /></Button>
        <Button variant="outline" size="sm" disabled={!backup} onClick={() => openEditor("trigger")}><GitBranch />{text("编辑触发条件", "Edit trigger")}</Button>
        <Button variant="outline" size="sm" disabled={!backup} onClick={() => openEditor("task")}><FileJson />{text("编辑任务", "Edit task")}</Button>
        <Button size="icon-sm" variant="destructive" disabled={!backup} onClick={() => setDeleteOpen(true)} aria-label={text("删除此副表", "Delete backup")}><Trash2 /></Button>
      </div>
      <ScheduleBoard
        rows={board.rows} layout={board.layout} activeShift={active + 1} planRevision={`mower-${active}`}
        roomProducts={board.products}
        eliteByOperator={eliteByOperator} levelByOperator={levelByOperator} searchQuery={scheduleQuery}
        shiftTabsSlot={(
          <Tabs value={String(active)} onValueChange={(value) => setActive(Number(value))} className="min-w-0 max-w-full">
            <TabsList className="h-auto max-w-full flex-wrap justify-start" aria-label={text("选择排班表", "Select plan")}>
              <TabsTrigger value="-1" className="px-3">{text("主表", "Main plan")}</TabsTrigger>
              {document.backup_plans.map((plan, index) => <TabsTrigger key={index} value={String(index)} className="max-w-48 px-3"><span className="truncate">{plan.name}</span></TabsTrigger>)}
            </TabsList>
          </Tabs>
        )}
        onSlotClick={(row) => openRoom(row.roomId, currentPlan[row.roomId]?.name || (row.roomId.startsWith("room_") ? "制造站" : row.groupLabel))}
        onFactoryRecipeChange={(roomId, recipe) => updateFacility(roomId, { ...currentPlan[roomId], name: "制造站", product: recipe === "battle_record" ? "exp3" : recipe === "originium" ? "orirock" : "gold" })}
        onTradeOrderChange={(roomId, order) => updateFacility(roomId, { ...currentPlan[roomId], name: "贸易站", product: order === "originium" ? "orundum" : "lmd" })}
        renderListRoomActions={(row, position) => position === "header" ? (
          <Button variant="outline" size="icon-sm" aria-label={`${text("编辑", "Edit ")}${row.title}`} onClick={() => openRoom(row.roomId, currentPlan[row.roomId]?.name || (row.roomId.startsWith("room_") ? "制造站" : row.groupLabel))}><Pencil /></Button>
        ) : null}
      />
      {["gaming_1", "gaming_2", "gaming_3"].some((key) => currentPlan[key]) ? <section className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">{["gaming_1", "gaming_2", "gaming_3"].filter((key) => currentPlan[key]).map((key) => renderRoom(key, `${text("活动室", "Activity room")} ${key.split("_")[1]}`))}</section> : null}

      <details className="mt-5 border-y border-border/70 bg-muted/15 px-3 py-3 sm:px-4" data-mower-rules>
        <summary className="cursor-pointer text-sm font-medium">{text("心情与调度规则", "Morale and scheduling rules")}</summary>
      <section className="grid gap-3 border-t border-border/70 pt-5">
        <div className="grid gap-3 sm:grid-cols-[210px_minmax(0,1fr)] sm:items-center"><span className="text-sm">{text("令夕模式", "Ling / Dusk mode")}</span><div className="flex flex-wrap gap-x-6 gap-y-2">{[[1, "感知信息", "Perception"], [2, "人间烟火", "Worldly"], [3, "均衡模式", "Balanced"]].map(([value, zh, english]) => <label key={value} className="flex items-center gap-2 text-sm"><input type="radio" name="mower-ling-xi" value={value} checked={Number(currentConf.ling_xi ?? 1) === value} onChange={() => changeConf("ling_xi", Number(value))} className="size-4 accent-blue-600" />{en ? english : zh}</label>)}</div></div>
        {[["rest_in_full", "需要回满心情的干员", "Rest to full morale"], ["exhaust_require", "需要用尽心情的干员", "Work to exhaustion"], ["workaholic", "0 心情工作的干员", "Work at zero morale"], ["resting_priority", "低优先级休息干员", "Low rest priority"], ["ope_resting_priority", "休息排序优先级", "Resting order priority"], ["refresh_trading", "跑单时间刷新干员", "Refresh trading timers"], ["refresh_drained", "用尽时间刷新干员", "Refresh exhaustion timers"]].map(([key, zh, english]) => <label key={key} className="grid gap-2 text-sm sm:grid-cols-[210px_minmax(0,1fr)] sm:items-center"><span>{en ? english : zh}</span><MowerOperatorPicker label={en ? english : zh} selected={String(currentConf[key as keyof typeof currentConf] ?? "").split(",").map((name) => name.trim()).filter(Boolean)} operators={boxOperators} onChange={(names) => changeConf(key!, names.join(","))} text={text} /></label>)}
      </section>

      </details>

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-h-[calc(100svh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-xl">
          <DialogHeader><DialogTitle>{text("排班信息", "Plan details")}</DialogTitle><DialogDescription>{text("标题、作者和笔记会随排班文件一起保存。", "The title, author and notes are saved with the plan file.")}</DialogDescription></DialogHeader>
          <DialogBody className="min-h-0 overflow-y-auto">
            <label className="grid gap-2 text-sm">{text("标题", "Title")}<Input value={document.title} onChange={(event) => setDocument({ ...document, title: event.target.value })} /></label>
            <label className="grid gap-2 text-sm">{text("作者", "Author")}<Input value={document.author} onChange={(event) => setDocument({ ...document, author: event.target.value })} /></label>
            <label className="grid gap-2 text-sm">{text("排班 ID", "Plan ID")}<Input value={document.id} onChange={(event) => setDocument({ ...document, id: event.target.value })} /></label>
            <label className="grid gap-2 text-sm">{text("笔记", "Notes")}<Textarea className="min-h-28" value={document.description} onChange={(event) => setDocument({ ...document, description: event.target.value })} /></label>
          </DialogBody>
          <DialogFooter><Button onClick={() => setDetailsOpen(false)}><Check />{text("完成", "Done")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingRoom)} onOpenChange={(open) => { if (!open) setEditingRoom(null); }}>
        <DialogContent className="max-h-[90svh] sm:max-w-[min(800px,calc(100vw-2rem))]">
          <DialogHeader><DialogTitle>{text("编辑设施", "Edit facility")} · {editingRoom}</DialogTitle><DialogDescription>{roomDraft.name}</DialogDescription></DialogHeader>
          <DialogBody className="max-h-[60svh] overflow-auto">
            {editingRoom?.startsWith("room_") ? <div className="flex flex-wrap gap-3"><select className={SELECT_CLASS} aria-label={text("设施类型", "Facility type")} value={roomDraft.name ?? "制造站"} onChange={(event) => setRoomDraft({ ...roomDraft, name: event.target.value, product: event.target.value === "贸易站" ? "lmd" : event.target.value === "制造站" ? "gold" : undefined })}><option value="贸易站">{text("贸易站", "Trading Post")}</option><option value="制造站">{text("制造站", "Factory")}</option><option value="发电站">{text("发电站", "Power Plant")}</option></select>{roomDraft.name !== "发电站" ? <select className={SELECT_CLASS} aria-label={text("产物", "Product")} value={roomDraft.product ?? (roomDraft.name === "贸易站" ? "lmd" : "gold")} onChange={(event) => setRoomDraft({ ...roomDraft, product: event.target.value })}>{(roomDraft.name === "贸易站" ? [["lmd", "龙门币", "LMD"], ["orundum", "合成玉", "Orundum"]] : [["gold", "赤金", "Gold"], ["exp3", "中级作战记录", "Battle Record"], ["orirock", "源石碎片", "Originium Shard"]]).map(([value, zh, english]) => <option key={value} value={value}>{en ? english : zh}</option>)}</select> : null}</div> : null}
            <div className="space-y-3">{(roomDraft.plans ?? []).map((operator, index) => <div key={index} className="grid grid-cols-[40px_minmax(0,1fr)_32px] items-start gap-2 border-b border-border/60 pb-3"><Portrait name={operator.agent} /><div className="grid gap-2 sm:grid-cols-2"><Input className={FIELD_CLASS} list="mower-operator-names" value={operator.agent} aria-label={`${text("干员", "Operator")} ${index + 1}`} onChange={(event) => setRoomDraft({ ...roomDraft, plans: roomDraft.plans?.map((entry, position) => position === index ? { ...entry, agent: event.target.value } : entry) })} /><Input className={FIELD_CLASS} value={operator.group ?? ""} placeholder={text("分组", "Group")} aria-label={`${text("分组", "Group")} ${index + 1}`} onChange={(event) => setRoomDraft({ ...roomDraft, plans: roomDraft.plans?.map((entry, position) => position === index ? { ...entry, group: event.target.value } : entry) })} /><Input className={cn(FIELD_CLASS, "sm:col-span-2")} value={(operator.replacement ?? []).join(", ")} placeholder={text("替换干员", "Replacement operators")} aria-label={`${text("替换干员", "Replacements")} ${index + 1}`} onChange={(event) => setRoomDraft({ ...roomDraft, plans: roomDraft.plans?.map((entry, position) => position === index ? { ...entry, replacement: event.target.value.split(/[,，]/).map((name) => name.trim()) } : entry) })} /></div><Button variant="ghost" size="icon" onClick={() => setRoomDraft({ ...roomDraft, plans: roomDraft.plans?.filter((_, position) => position !== index) })} aria-label={text("移除干员", "Remove operator")}><Trash2 /></Button></div>)}</div>
            <Button variant="outline" disabled={(roomDraft.plans?.length ?? 0) >= capacityFor(editingRoom ?? "", roomDraft.name)} onClick={() => setRoomDraft({ ...roomDraft, plans: [...(roomDraft.plans ?? []), { agent: "", group: "", replacement: [] }] })}><Users />{text("添加干员", "Add operator")}</Button>
            <datalist id="mower-operator-names"><option value="Free" />{OPERATOR_CATALOG.map((operator) => <option key={operator.id} value={operator.name} />)}</datalist>
          </DialogBody>
          <DialogFooter><Button variant="ghost" onClick={() => setEditingRoom(null)}>{text("取消", "Cancel")}</Button><Button onClick={() => { if (editingRoom) updateFacility(editingRoom, { ...roomDraft, plans: (roomDraft.plans ?? []).filter((entry) => entry.agent.trim()).slice(0, capacityFor(editingRoom, roomDraft.name)).map((entry) => ({ ...entry, agent: entry.agent.trim(), replacement: (entry.replacement ?? []).filter(Boolean) })) }); setEditingRoom(null); }}><Check />{text("保存", "Save")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editorMode)} onOpenChange={(open) => { if (!open) setEditorMode(null); }}>
        <DialogContent className="sm:max-w-[min(660px,calc(100vw-2rem))]"><DialogHeader><DialogTitle>{editorMode === "rename" ? text("重命名副表", "Rename backup") : editorMode === "trigger" ? text("编辑触发条件", "Edit trigger") : text("编辑任务", "Edit task")}</DialogTitle><DialogDescription>{backup?.name}</DialogDescription></DialogHeader><DialogBody>{editorMode === "rename" ? <Input value={editorValue} onChange={(event) => setEditorValue(event.target.value)} aria-label={text("副表名称", "Backup name")} /> : <Textarea className="min-h-64 font-mono text-xs" value={editorValue} onChange={(event) => setEditorValue(event.target.value)} aria-label="JSON" />}{editorMode === "trigger" && backup ? <select className={SELECT_CLASS} value={triggerTiming} aria-label={text("触发时机", "Trigger timing")} onChange={(event) => setTriggerTiming(event.target.value)}>{["BEGINNING", "BEFORE_PLANNING", "AFTER_PLANNING", "END"].map((timing) => <option key={timing}>{timing}</option>)}</select> : null}{editorError ? <p className="text-sm text-destructive" role="alert">{editorError}</p> : null}</DialogBody><DialogFooter><Button variant="ghost" onClick={() => setEditorMode(null)}>{text("取消", "Cancel")}</Button><Button onClick={saveEditor}><Check />{text("保存", "Save")}</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}><DialogContent><DialogHeader><DialogTitle>{text("删除副表？", "Delete backup?")}</DialogTitle><DialogDescription>{backup?.name}</DialogDescription></DialogHeader><DialogFooter><Button variant="ghost" onClick={() => setDeleteOpen(false)}>{text("取消", "Cancel")}</Button><Button variant="destructive" onClick={() => { setDocument((current) => ({ ...current, backup_plans: current.backup_plans.filter((_, index) => index !== active) })); setActive(-1); setDeleteOpen(false); }}><Trash2 />{text("删除", "Delete")}</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}
