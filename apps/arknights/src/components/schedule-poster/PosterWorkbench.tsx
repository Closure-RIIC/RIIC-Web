"use client";

import { localizedOperationError } from "@/operation-error-presentation";

import { useLocale as useRawLocale } from "use-intl";
import { createLocalizer as createRawLocalizer, richValue } from "@riic/arknights-domain/i18n/localize";
import type RawMessages from "../../../messages/zh-CN/AK_Raw_components_schedule_poster_PosterWorkbench.json";
const rawText = createRawLocalizer<typeof RawMessages>("AK_Raw_components_schedule_poster_PosterWorkbench");


import { useEffect, useRef, useState, type ReactNode } from "react";
import { Download, FileText, ImageDown, Link2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { downloadJson } from "@/download";
import { manualScheduleToMaa, resizeManualScheduleDraft, type ManualScheduleDraft } from "@/manual-schedule";
import { prepareMaaForExport } from "@riic/arknights-domain/maa-safety";
import { OPERATOR_CATALOG } from "@/operatorPortraits";
import { manualEditableRooms } from "@/recycling-room";
import { posterDataOnly, POSTER_MAX_BYTES, readPosterFile, type SchedulePosterDocument } from "@/schedule-poster-document";
import { posterRoomTitle, posterDisplayTitle } from "@/schedule-poster-model";
import { applyScheduleText, scheduleDraftToText } from "@/schedule-poster-text";
import type { ManualPlanResult } from "@/manual-plan-result";
import { SchedulePoster, type PosterTarget } from "./SchedulePoster";
import "./poster-fonts.css";
import "./schedule-poster.css";

type Props = {
  document: SchedulePosterDocument;
  onChange: (document: SchedulePosterDocument) => void;
  onImport: (document: SchedulePosterDocument) => void;
  onSelect: (target: PosterTarget) => void;
  result: ManualPlanResult | null;
  pending: boolean;
  onCalculate: (mode: "native" | "manual") => Promise<void>;
};
function Field({ title, children }: { title: string; children: ReactNode }) {
  return <label className="grid min-w-0 content-start gap-2 text-sm"><span className="text-muted-foreground">{title}</span>{children}</label>;
}
function Choice({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  const selected = options.find(option => option.value === value) ?? null;
  return <Combobox items={options} filteredItems={options} value={selected} inputValue={selected?.label ?? ""}
    itemToStringValue={option => option.label} isItemEqualToValue={(a, b) => a.value === b.value} onValueChange={option => { if (option) onChange(option.value); }}>
    <ComboboxInput aria-label={label} readOnly className="w-full" />
    <ComboboxContent><ComboboxList>{option => <ComboboxItem key={option.value} value={option}>{option.label}</ComboboxItem>}</ComboboxList></ComboboxContent>
  </Combobox>;
}
export default function PosterWorkbench({ document: doc, onChange, onImport, onSelect, result, pending, onCalculate }: Props) {
  const rawLocale = useRawLocale();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [background, setBackground] = useState<string | null>(null);
  const [share, setShare] = useState<{ key: string; code: string; url: string } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [auto, setAuto] = useState(true);
  const [codeInput, setCodeInput] = useState("");
  const [shareOrigin, setShareOrigin] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkErrors, setBulkErrors] = useState<string[]>([]);
  const [bulkBase, setBulkBase] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const calculate = useRef(onCalculate);
  const attemptedCalculation = useRef("");
  useEffect(() => { calculate.current = onCalculate; }, [onCalculate]);
  const snapshotKey = JSON.stringify(posterSnapshot(doc));
  const scheduledNames = new Set(doc.draft.shifts.flatMap(shift => Object.values(shift.rooms).flatMap(room => room.operators)).filter((name): name is string => Boolean(name)));
  if (doc.draft.fiammettaEnabled) scheduledNames.add("菲亚梅塔");
  const calculationOperators = doc.operators.filter(operator => scheduledNames.has(operator.name));
  const calculationKey = JSON.stringify([doc.layout, { ...doc.draft, activeShift: 0 }, calculationOperators, doc.efficiencyMode]);
  const validShare = share?.key === snapshotKey ? share : null;
  const supported = doc.draft.shifts.length >= 1 && doc.draft.shifts.length <= 4;
  useEffect(() => { setShareOrigin(window.location.origin); }, []);
  useEffect(() => () => { if (background) URL.revokeObjectURL(background); }, [background]);
  useEffect(() => {
    if (!auto || !supported || pending || result || attemptedCalculation.current === calculationKey) return;
    const timer = window.setTimeout(() => { attemptedCalculation.current = calculationKey; void calculate.current(doc.efficiencyMode).catch(e => setError(String(e))); }, 650);
    return () => window.clearTimeout(timer);
  }, [calculationKey, auto, supported, doc.efficiencyMode, pending, result]);

  function meta(key: keyof SchedulePosterDocument["meta"], value: string) { onChange({ ...doc, meta: { ...doc.meta, [key]: value } }); }
  function updateDraft(draft: ManualScheduleDraft) {
    const generated = /^\d{3} [一二两三四1234]班轮换$/.test(doc.meta.title);
    onChange({ ...doc, draft, ...(generated ? { meta: { ...doc.meta, title: `${doc.layout.template} ${draft.shifts.length}班轮换` } } : {}) });
  }
  function openBulk() {
    setBulkText(scheduleDraftToText(doc.layout, doc.draft));
    setBulkBase(JSON.stringify([doc.layout, doc.draft])); setBulkErrors([]); setBulkOpen(true);
  }
  function applyBulk() {
    if (bulkBase !== JSON.stringify([doc.layout, doc.draft])) { setBulkErrors([rawText.text(rawLocale, "draftChanged")]); return; }
    const parsed = applyScheduleText(bulkText, doc.layout, doc.draft, new Set(OPERATOR_CATALOG.map(operator => operator.name)), rawLocale);
    setBulkErrors(parsed.errors);
    if (parsed.errors.length) return;
    updateDraft(parsed.draft); setBulkOpen(false); setError("");
    setNotice(rawText.text(rawLocale, "rowsApplied", { count: parsed.changedRows }));
  }
  async function importFile(file: File) {
    try {
      if (file.size > POSTER_MAX_BYTES) throw new Error(rawText.text(rawLocale, "fileTooLarge"));
      onImport(readPosterFile(await file.text())); setNotice(rawText.text(rawLocale, "fileImported", { name: file.name })); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : rawText.text(rawLocale, "importFailed")); }
  }
  async function generateShare() {
    setSharing(true);
    try {
      const origin = new URL(shareOrigin);
      if (!["http:", "https:"].includes(origin.protocol)) throw new Error(rawText.text(rawLocale, "invalidUrl"));
      const response = await fetch("/api/schedule-posters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(posterDataOnly(doc)) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error);
      const url = new URL("/manual", origin.origin); url.searchParams.set("tab", "poster"); url.searchParams.set("code", payload.code);
      setShare({ key: snapshotKey, code: payload.code, url: url.href }); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : rawText.text(rawLocale, "generateFailed")); }
    finally { setSharing(false); }
  }
  async function openCode() {
    try {
      const code = codeInput.trim(); if (!/^[a-f0-9]{12}$/.test(code)) throw new Error(rawText.text(rawLocale, "invalidCode"));
      const response = await fetch(`/api/schedule-posters?code=${code}`); const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      const next = readPosterFile(JSON.stringify(payload.document)); onImport(next);
      setShare({ key: JSON.stringify(posterSnapshot(next)), code, url: `${window.location.origin}/manual?tab=poster&code=${code}` });
      setNotice(rawText.text(rawLocale, "loaded")); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : rawText.text(rawLocale, "loadFailed")); }
  }
  async function exportImage() {
    setExporting(true);
    try {
      const board = preview.current?.querySelector<HTMLElement>("[data-schedule-poster]"); if (!board) return;
      const { default: html2canvas } = await import("html2canvas-pro");
      const { downloadCanvasImage } = await import("@/schedule-image");
      await Promise.all([400, 500, 600, 700].map(weight => document.fonts.load(`${weight} 16px "Poster Source Han Sans"`, board.textContent ?? "")));
      await document.fonts.ready;
      await Promise.all(Array.from(board.querySelectorAll("img"), image => {
        // Export also needs portraits outside the scroll viewport.
        image.loading = "eager";
        return image.decode().catch(() => {});
      }));
      const canvas = await html2canvas(board, { scale: 1, width: 1920, height: 1080, windowWidth: 1920, windowHeight: 1080, logging: false, useCORS: true, onclone(clone) {
        const poster = clone.querySelector<HTMLElement>("[data-schedule-poster]");
        // Move out of scaled/animated workbench ancestors before rasterizing.
        if (poster) { clone.body.appendChild(poster); poster.style.transform = "none"; poster.style.position = "fixed"; poster.style.left = "0"; poster.style.top = "0"; }
      } });
      await downloadCanvasImage(canvas, `${posterDisplayTitle(doc, rawLocale) || rawText.text(rawLocale, "filename")}.png`); setNotice(rawText.text(rawLocale, "imageExported"));
    } catch (e) { setError(e instanceof Error ? e.message : rawText.text(rawLocale, "exportFailed")); }
    finally { setExporting(false); }
  }
  function download() { try { downloadJson(`${doc.meta.title || rawText.text(rawLocale, "filename")}.riic.json`, posterDataOnly(doc)); } catch (e) { setError(String(e)); } }
  function downloadMaa() {
    try {
      const cycleHours = doc.draft.shifts.reduce((sum, shift) => sum + shift.durationHours, 0);
      const exportDraft = Math.abs(cycleHours - 24) > 0.001 && doc.draft.scheduleMode === "period"
        ? { ...doc.draft, scheduleMode: "sequential" as const }
        : doc.draft;
      const maa = prepareMaaForExport(manualScheduleToMaa(exportDraft, doc.layout, exportDraft.fiammettaEnabled));
      downloadJson(`${doc.meta.title || rawText.text(rawLocale, "filename")}.maa.json`, maa);
      setNotice(rawText.text(rawLocale, "maaExported", { multi: Math.abs(cycleHours - 24) > 0.001 ? "yes" : "no" }));
    } catch (e) { setError(e instanceof Error ? e.message : rawText.text(rawLocale, "maaExportFailed")); }
  }
  return <div className="min-w-0 space-y-4" data-poster-workbench>
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" onClick={openBulk}>{rawText.rich(rawLocale, "fillScheduleInBulk", { part1: richValue((<FileText />)) })}</Button>
      <Button variant="outline" onClick={() => fileInput.current?.click()}>{rawText.rich(rawLocale, "importScheduleFile", { part1: richValue((<Upload />)) })}</Button>
      <Button variant="outline" onClick={download} disabled={!supported}>{rawText.rich(rawLocale, "downloadScheduleFile", { part1: richValue((<Download />)) })}</Button>
      <Button variant="outline" onClick={downloadMaa} disabled={!supported}>{rawText.rich(rawLocale, "exportMaa", { part1: richValue((<Download />)) })}</Button>
      <Button variant="outline" onClick={() => void generateShare()} disabled={sharing || !supported}><Link2 />{sharing ? rawText.text(rawLocale, "generating") : rawText.text(rawLocale, "generateScheduleCode")}</Button>
      <Button onClick={() => void exportImage()} disabled={exporting || !supported}><ImageDown />{exporting ? rawText.text(rawLocale, "exporting") : rawText.text(rawLocale, "exportSinglePagePng")}</Button>
      <input ref={fileInput} type="file" accept=".json" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = ""; }} />
    </div>
    <details className="border-y border-border py-3" open>
      <summary className="cursor-pointer text-sm font-medium">{rawText.text(rawLocale, "scheduleDetailsAndShifts")}</summary>
      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid gap-3">
          <div className="grid grid-cols-[2fr_1fr] gap-3"><Field title={rawText.text(rawLocale, "scheduleName")}><Input value={posterDisplayTitle(doc, rawLocale)} maxLength={40} onChange={e => meta("title", e.target.value)} /></Field><Field title={rawText.text(rawLocale, "author")}><Input value={doc.meta.author} maxLength={40} onChange={e => meta("author", e.target.value)} /></Field></div>
          <Field title={rawText.text(rawLocale, "instructions")}><Textarea value={doc.meta.instructions} maxLength={240} onChange={e => meta("instructions", e.target.value)} /></Field>
          <label className="flex items-center gap-2 text-sm">{rawText.rich(rawLocale, "showInstructions", { part1: richValue((<Switch checked={doc.presentation.showInstructions} onCheckedChange={showInstructions => onChange({ ...doc, presentation: { ...doc.presentation, showInstructions } })} />)) })}</label>
        </div>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{rawText.rich(rawLocale, "currentLayoutAdjustFacilityLayoutAndLevelsInRoster", { part1: richValue((doc.layout.template)) })}</p>
          <div className="grid grid-cols-2 gap-3">
            <Field title={rawText.text(rawLocale, "shifts")}><Choice label={rawText.text(rawLocale, "shifts")} value={String(doc.draft.shifts.length)} options={[1, 2, 3, 4].map(count => ({ value: String(count), label: rawText.text(rawLocale, "shiftCount", { count }) }))} onChange={value => updateDraft(resizeManualScheduleDraft(doc.draft, Array.from({ length: Number(value) }, () => 24 / Number(value))))} /></Field>
            <div className="grid min-w-0 content-start gap-2 text-sm"><span className="text-muted-foreground">{rawText.text(rawLocale, "firstShiftStartTime")}</span><div className="flex min-w-0 gap-2"><Input type="time" aria-label={rawText.text(rawLocale, "firstShiftStartTime")} value={doc.draft.startTime} placeholder={rawText.text(rawLocale, "default0800")} onChange={e => updateDraft({ ...doc.draft, startTime: e.target.value })} />{doc.draft.startTime ? <Button type="button" size="icon" variant="ghost" aria-label={rawText.text(rawLocale, "clearFirstShiftStartTime")} title={rawText.text(rawLocale, "clearingUsesTheDefaultTime")} onClick={() => updateDraft({ ...doc.draft, startTime: "" })}><X /></Button> : null}</div></div>
          </div>
          <div className="flex flex-wrap gap-3">{doc.draft.shifts.map((shift, index) => <div className="w-28" key={index}><Field title={rawText.text(rawLocale, "shiftDuration", { shift: index + 1 })}><Input type="number" min={.25} max={24} step={.25} value={shift.durationHours} onChange={e => {
            const durations = doc.draft.shifts.map(item => item.durationHours); const value = Number(e.target.value);
            if (!Number.isFinite(value) || value < .25 || value > 24) return;
            durations[index] = value; updateDraft(resizeManualScheduleDraft(doc.draft, durations));
          }} /></Field></div>)}<p className="self-end pb-2 text-xs text-muted-foreground">{rawText.rich(rawLocale, "rotationCycleH", { part1: richValue((doc.draft.shifts.reduce((sum, shift) => sum + shift.durationHours, 0))) })}</p></div>
          <Field title={rawText.text(rawLocale, "productionCalculation")}><Choice label={rawText.text(rawLocale, "productionCalculation")} value={doc.efficiencyMode} options={[{ value: "native", label: rawText.text(rawLocale, "automaticProduction") }, { value: "manual", label: rawText.text(rawLocale, "manualProduction") }]} onChange={value => onChange({ ...doc, efficiencyMode: value as "native" | "manual" })} /></Field>
          <div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-sm">{rawText.rich(rawLocale, "calculateAutomaticallyAfterChanges", { part1: richValue((<Switch checked={auto} onCheckedChange={setAuto} />)) })}</label><Button size="sm" variant="outline" disabled={pending} onClick={() => void onCalculate(doc.efficiencyMode).catch(e => setError(String(e)))}>{pending ? rawText.text(rawLocale, "calculating") : rawText.text(rawLocale, "recalculate")}</Button></div>
          <details className="text-xs leading-5 text-muted-foreground"><summary className="cursor-pointer">{rawText.text(rawLocale, "productionMethodology")}</summary><div className="mt-2 space-y-1">
            <p>{rawText.text(rawLocale, "tradingPostsShowSkillEfficiencyAndEquivalentEfficiencySeparately")}</p>
            <p>{rawText.text(rawLocale, "automaticModeCalculatesSkillEfficiencyFromTheScheduleS")}</p>
            <p>{rawText.text(rawLocale, "productionIsConvertedToADailyRateUsingThe")}</p>
            <p>{rawText.text(rawLocale, "pureGoldValueManufacturingDronesImplicitGoldImplicitGold")}</p>
            <p>{rawText.text(rawLocale, "droneStatisticsCurrentlyCoverLmdOrdersPureGoldAnd")}</p>
          </div></details>
        </div>
      </div>
    </details>
    <div className="flex flex-wrap gap-x-8 gap-y-3">
      <details className="min-w-64 flex-1"><summary className="cursor-pointer text-sm">{rawText.text(rawLocale, "backgroundAndVisibleFacilities")}</summary><div className="mt-3 grid gap-3">
        <div className="flex flex-wrap gap-4">{manualEditableRooms(doc.layout).filter(room => ["workshop", "training_room", "recycling"].includes(room.kind)).map(room => <label key={room.id} className="flex items-center gap-2 text-sm">{rawText.rich(rawLocale, "show", { part1: richValue((<Switch checked={!doc.presentation.hiddenFacilities.includes(room.id)} onCheckedChange={checked => onChange({ ...doc, presentation: { ...doc.presentation, hiddenFacilities: checked ? doc.presentation.hiddenFacilities.filter(id => id !== room.id) : [...doc.presentation.hiddenFacilities, room.id] } })} />)), part2: richValue((posterRoomTitle(room, doc.layout, rawLocale))) })}</label>)}</div>
        <p className="text-xs text-muted-foreground">{rawText.text(rawLocale, "hidingAFacilityAffectsOnlyTheImageItsAssignments")}</p>
        <div className="flex flex-wrap items-center gap-3"><Field title={rawText.text(rawLocale, "backgroundColor")}><Input type="color" className="w-20" value={doc.presentation.backgroundColor} onChange={e => onChange({ ...doc, presentation: { ...doc.presentation, backgroundColor: e.target.value } })} /></Field><Field title={rawText.text(rawLocale, "replaceBackgroundImage")}><Input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { const file = e.target.files?.[0]; if (file) { if (file.size > 10 * 1024 * 1024) { setError(rawText.text(rawLocale, "backgroundTooLarge")); return; } setBackground(URL.createObjectURL(file)); } }} /></Field><Button variant="ghost" onClick={() => setBackground(null)}>{rawText.text(rawLocale, "clearBackground")}</Button></div>
        <p className="text-xs text-muted-foreground">{rawText.text(rawLocale, "theBackgroundImageIsUsedOnlyForThisExport")}</p>
      </div></details>
      <details className="min-w-64 flex-1"><summary className="cursor-pointer text-sm">{rawText.text(rawLocale, "loadScheduleCodeAndQrDestination")}</summary><div className="mt-3 grid gap-3"><Field title={rawText.text(rawLocale, "qrDestinationUrl")}><Input value={shareOrigin} onChange={e => { setShareOrigin(e.target.value); setShare(null); }} /></Field><p className="text-xs text-muted-foreground">{rawText.text(rawLocale, "theQrCodeContainsOnlyTheUrlAnd12")}</p><p className="text-xs text-muted-foreground">{rawText.text(rawLocale, "forLocalPhoneScanningEnterThisComputerSLan")}</p><div className="flex gap-2"><Input aria-label={rawText.text(rawLocale, "scheduleCode")} placeholder={rawText.text(rawLocale, "12CharacterScheduleCode")} value={codeInput} onChange={e => setCodeInput(e.target.value)} maxLength={12} /><Button variant="outline" onClick={() => void openCode()}>{rawText.text(rawLocale, "loadSchedule")}</Button></div></div></details>
    </div>
    {error ? <p role="alert" className="whitespace-pre-line text-sm text-destructive">{localizedOperationError(error, rawLocale)}</p> : null}
    {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
    {supported ? <div ref={preview}><div className="mb-2 flex justify-between text-xs text-muted-foreground"><span>{rawText.text(rawLocale, "19201080SelectAPortraitToOpenTheOperator")}</span><span>{pending ? rawText.text(rawLocale, "calculating2") : result ? rawText.text(rawLocale, "calculated") : rawText.text(rawLocale, "notCalculatedYet")}</span></div><SchedulePoster document={doc} result={result} background={background} share={validShare} onSelect={onSelect} /></div> : <p className="border p-4 text-sm">{rawText.text(rawLocale, "singlePagePostersSupport14ShiftsYourCurrent")}</p>}
    {validShare ? <div className="flex flex-wrap items-center gap-3 border-y py-3 text-sm"><span>{rawText.rich(rawLocale, "scheduleCode2", { part1: richValue((<strong className="font-mono">{validShare.code}</strong>)) })}</span><Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(validShare.code).then(() => setNotice(rawText.text(rawLocale, "copied"))).catch(() => setNotice(rawText.text(rawLocale, "copyManually")))}>{rawText.text(rawLocale, "copy")}</Button><a className="break-all underline" href={validShare.url}>{validShare.url}</a><span className="text-xs text-muted-foreground">{rawText.text(rawLocale, "generateANewScheduleCodeAfterMakingChanges")}</span></div> : null}
    <Dialog open={bulkOpen} onOpenChange={setBulkOpen}><DialogContent className="flex max-h-[90svh] w-[96vw] flex-col sm:max-w-5xl">
      <DialogHeader><DialogTitle>{rawText.text(rawLocale, "fillFacilitiesAndOperatorsInBulk")}</DialogTitle><DialogDescription>{rawText.text(rawLocale, "useOneFacilityPerLineAndSeparateShiftsWith")}</DialogDescription></DialogHeader>
      <DialogBody className="min-h-0 space-y-3 overflow-auto">
        <p className="text-sm leading-6">{rawText.rich(rawLocale, "separateOperatorsWithUseOrInASlotFor", { part1: richValue((<code>auto</code>)), part2: richValue((<code>Free</code>)), part3: richValue((<code>@auto</code>)), part4: richValue((<code>@manual</code>)), part5: richValue((<code>@90%</code>)), part6: richValue((<code>{rawText.text(rawLocale, "label")}</code>)), part7: richValue((<code>{rawText.text(rawLocale, "label2")}</code>)), part8: richValue((<code>{rawText.text(rawLocale, "label3")}</code>)), part9: richValue((<code>=</code>)), part10: richValue((<code>-</code>)), part11: richValue((<code>auto</code>)), part12: richValue((<code>_</code>)) })}</p>
        <p className="text-xs text-muted-foreground">{rawText.rich(rawLocale, "whenExportingToMaaAnyAutoEntryEnablesFor", { part1: richValue((<code>autofill</code>)) })}</p>
        <div className="overflow-x-auto"><Textarea aria-label={rawText.text(rawLocale, "bulkScheduleText")} value={bulkText} onChange={e => setBulkText(e.target.value)} spellCheck={false} wrap="off" className="h-[min(48vh,480px)] min-w-[760px] resize-y font-mono text-sm leading-8 [field-sizing:fixed]" /></div>
        {bulkErrors.length ? <div role="alert" className="space-y-1 text-sm text-destructive">{bulkErrors.map((message, index) => <p key={index}>{message}</p>)}</div> : null}
      </DialogBody><DialogFooter><Button variant="outline" onClick={openBulk}>{rawText.text(rawLocale, "reloadCurrentSchedule")}</Button><Button variant="outline" onClick={() => setBulkOpen(false)}>{rawText.text(rawLocale, "cancel")}</Button><Button onClick={applyBulk}>{rawText.text(rawLocale, "checkAndApply")}</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
function posterSnapshot(doc: SchedulePosterDocument) { return { ...doc, draft: { ...doc.draft, activeShift: 0 } }; }
