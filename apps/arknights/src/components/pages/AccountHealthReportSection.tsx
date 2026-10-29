"use client";

import { createLocalizer as createUiLocalizer } from "@riic/arknights-domain/i18n/localize";
import type UiMessages from "../../../messages/zh-CN/AK_components_pages_AccountHealthReportSection.json";
const uiText = createUiLocalizer<typeof UiMessages>("AK_components_pages_AccountHealthReportSection");
import type { AppLocale } from "@riic/contracts/locale";
import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardList, Upload } from "lucide-react";

import { getGameReport, postGameReport } from "@/api";
import { FileUploadDialog } from "@/components/FileUploadDialog";
import { SetupActionButton } from "@/components/setup/SetupActionButton";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GAME_REPORT_KEYS, gameReportAverage, parseGameReportDays, type GameReportRecord, type GameReportSource } from "@riic/arknights-domain/game-report";
import { recognizeReport } from "@/report-recognition/recognize";
import { RECOGNITION_CONFIDENT_DISTANCE, type ReportMetricKey } from "@/report-recognition/types";

const LABELS: Record<ReportMetricKey, keyof typeof UiMessages> = {"experience":"experience","goldValue":"goldValue","lmd":"lmd","orderCount":"orderCount","orundum":"orundum"};
type Draft = Record<ReportMetricKey, string>;
const blankDay = (): Draft => ({ experience: "", goldValue: "", lmd: "", orderCount: "", orundum: "" });

export function AccountHealthReportSection({ en, authenticated, onRecordChange }: { en: AppLocale; authenticated: boolean; onRecordChange: (value: GameReportRecord | null) => void }) {
  const localeRef = useRef(en);
  useEffect(() => { localeRef.current = en; }, [en]);
  const [mode, setMode] = useState<GameReportSource>("screenshot");
  const [draft, setDraft] = useState<[Draft, Draft, Draft]>([blankDay(), blankDay(), blankDay()]);
  const [record, setRecord] = useState<GameReportRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!authenticated) { setRecord(null); onRecordChange(null); return; }
    setLoading(true);
    try {
      const latest = await getGameReport();
      setRecord(latest);
      onRecordChange(latest);
      if (latest) {
        setDraft(latest.days.map((day) => Object.fromEntries(GAME_REPORT_KEYS.map((key) => [key, day[key] === undefined ? "" : String(day[key])]))) as [Draft, Draft, Draft]);
        setMode(latest.sourceType);
      }
      setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : (uiText.text(localeRef.current, "couldNotLoadReport"))); }
    finally { setLoading(false); }
  }, [authenticated, onRecordChange]);
  useEffect(() => { void load(); }, [load]);

  async function handleImage(file: File, signal: AbortSignal) {
    if (!file.type.startsWith("image/") || file.size > 15 * 1024 * 1024) throw new Error(uiText.text(en, "chooseAPngOrJpegUnder15Mb"));
    const bitmap = await createImageBitmap(file);
    try {
      if (signal.aborted) return;
      if (bitmap.width * bitmap.height > 16_000_000) throw new Error(uiText.text(en, "imageIsTooLarge"));
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error(uiText.text(en, "imageCannotBeDecoded"));
      context.drawImage(bitmap, 0, 0);
      const result = recognizeReport(context.getImageData(0, 0, bitmap.width, bitmap.height));
      if (signal.aborted) return;
      if ("ok" in result) {
        throw new Error(result.reason === "decode"
          ? (uiText.text(en, "theImageCouldNotBeDecodedTryExporting"))
          : (uiText.text(en, "reportPanelsWereNotFoundUploadAComplete")));
      }
      if (result.kind === "single-day") {
        setDraft([blankDay(), blankDay(), blankDay()]);
        setNotice(uiText.text(en, "pleaseSubmitAThreeDayReport"));
        setError(null);
        return;
      }
      const uncertain: string[] = [];
      const needsManualReading = file.type === "image/jpeg" || result.warnings.includes("low-resolution") || result.warnings.includes("odd-aspect-ratio");
      const next = result.days.map((day, index) => {
        const item = blankDay();
        for (const key of GAME_REPORT_KEYS) {
          const found = day[key];
          if (found && !needsManualReading && found.maxDistance <= RECOGNITION_CONFIDENT_DISTANCE) item[key] = String(found.value);
          else uncertain.push(`${index + 1}: ${uiText.text(en, LABELS[key])}`);
        }
        return item;
      }) as [Draft, Draft, Draft];
      setDraft(next);
      setMode("screenshot");
      const reviewReason = file.type === "image/jpeg"
        ? (uiText.text(en, "jpegCompressionRequiresManualChecking"))
        : result.warnings.includes("low-resolution")
          ? (uiText.text(en, "theImageIsLowResolutionCheckTheBlank"))
          : result.warnings.includes("odd-aspect-ratio")
            ? (uiText.text(en, "thisScreenshotLayoutIsNotSupportedYetCheck"))
            : (uiText.text(en, "checkTheBlankFieldsBeforeSaving"));
      setNotice(uncertain.length || result.warnings.length || file.type === "image/jpeg"
        ? reviewReason
        : (uiText.text(en, "recognitionCompleteCheckAllValuesBeforeSaving")));
      setError(null);
    } catch (cause) {
      if (!signal.aborted) {
        const message = cause instanceof Error ? cause.message : (uiText.text(en, "couldNotRecognizeTheReportImage"));
        setNotice(null);
        setError(message);
      }
      throw cause;
    } finally { bitmap.close(); }
  }

  function update(day: number, key: ReportMetricKey, value: string) {
    if (!/^\d{0,8}$/.test(value)) return;
    setDraft((current) => current.map((item, index) => index === day ? { ...item, [key]: value } : item) as [Draft, Draft, Draft]);
  }

  const parsed = parseGameReportDays(draft.map((day) => Object.fromEntries(GAME_REPORT_KEYS.map((key) => [key, day[key] === "" ? null : Number(day[key])]))), false, true);
  const hasBlankFields = draft.some((day) => GAME_REPORT_KEYS.some((key) => day[key] === ""));
  async function save() {
    if (!parsed || !authenticated) return;
    setSaving(true);
    try {
      const saved = await postGameReport(parsed, mode);
      setRecord(saved);
      onRecordChange(saved);
      setError(null);
      setNotice(hasBlankFields
        ? (uiText.text(en, "threeDayReportSavedEmptyFieldsAreExcluded"))
        : (uiText.text(en, "threeDayReportSaved")));
    } catch (cause) { setError(cause instanceof Error ? cause.message : (uiText.text(en, "couldNotSaveReport"))); }
    finally { setSaving(false); }
  }
  const average = record ? gameReportAverage(record.days) : null;

  return <section className="min-w-0 rounded-[4px] border border-border bg-card p-3 md:p-6" aria-labelledby="game-report-title" data-game-report-section>
    <h2 id="game-report-title" className="flex items-center gap-2 text-sm font-semibold"><ClipboardList className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />{uiText.text(en, "threeDayBaseReport")}</h2>
    <Tabs value={mode} onValueChange={(value) => setMode(value as GameReportSource)} className="mt-4 min-w-0 max-md:[&_[data-slot=tabs-list]]:w-full max-md:[&_[data-slot=tabs-trigger]]:min-h-11 max-md:[&_[data-slot=tabs-trigger]]:min-w-0 max-md:[&_[data-slot=tabs-trigger]]:text-xs">
      <TabsList aria-label={uiText.text(en, "reportEntryMethod")}><TabsTrigger value="screenshot">{uiText.text(en, "screenshot")}</TabsTrigger><TabsTrigger value="manual">{uiText.text(en, "manual")}</TabsTrigger></TabsList>
      <TabsContent value="screenshot" className="pt-3 md:pt-4"><FileUploadDialog title={uiText.text(en, "uploadBaseReport")} description={uiText.text(en, "useACompleteOriginalScreenshot")} extensions={[".png", ".jpg", ".jpeg"]} onFiles={([file], signal) => handleImage(file!, signal)} trigger={<SetupActionButton type="button" variant="outline"><Upload aria-hidden="true" />{uiText.text(en, "chooseScreenshot")}</SetupActionButton>} /></TabsContent>
      <TabsContent value="manual" className="pt-3 md:pt-4"><p className="text-xs leading-5 text-muted-foreground">{uiText.text(en, "enterTheThreeDaysFromLeftToRight")}</p></TabsContent>
    </Tabs>
    {notice ? <p className="mt-3 text-sm text-amber-700 dark:text-amber-300" role="status">{notice}</p> : null}
    {error ? <p className="mt-3 text-sm text-destructive" role="alert">{error}</p> : null}
    <div className="mt-4 min-w-0">
      <table className="w-full table-fixed border-collapse text-xs md:text-sm">
        <colgroup><col className="w-[31%] sm:w-[28%]" /><col /><col /><col /></colgroup>
        <thead><tr className="border-y border-border text-muted-foreground">
          <th scope="col" className="py-3 pr-2 text-left font-medium">{uiText.text(en, "metric")}</th>
          {[0, 1, 2].map((day) => <th key={day} scope="col" className="px-1 py-3 text-center font-medium md:px-2">{uiText.text(en, "day", { value1: day + 1 })}</th>)}
        </tr></thead>
        <tbody>{GAME_REPORT_KEYS.map((key) => <tr key={key} className="border-b border-border/60 last:border-b-0">
          <th scope="row" className="break-words py-2 pr-2 text-left font-normal leading-5 text-muted-foreground">{uiText.text(en, LABELS[key])}</th>
          {draft.map((day, index) => <td key={index} className="px-1 py-2 md:px-2">
            <Input inputMode="numeric" pattern="[0-9]*" value={day[key]} onChange={(event) => update(index, key, event.target.value)} aria-label={`${uiText.text(en, LABELS[key])} ${uiText.text(en, "day2", { value1: index + 1 })}`} className="h-11 min-w-0 px-1 text-center font-number text-xs tabular-nums md:h-9 md:px-3 md:text-sm" />
          </td>)}
        </tr>)}</tbody>
      </table>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
      <SetupActionButton type="button" disabled={!parsed || saving || !authenticated} onClick={() => void save()}>{saving ? (uiText.text(en, "saving")) : (uiText.text(en, "confirmAndSave"))}</SetupActionButton>
      {parsed && hasBlankFields ? <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">{uiText.text(en, "blankFieldsWillBeSkipped")}</p> : null}
      {!authenticated ? <p className="text-xs leading-5 text-muted-foreground">{uiText.text(en, "signInToSaveThisReport")}</p> : null}
    </div>
    {record ? <div className="mt-5 border-t border-border pt-4" data-game-report-average>
      <p className="text-sm font-medium">{uiText.text(en, "latestSavedReportDailyAverage")}</p>
      <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">{GAME_REPORT_KEYS.map((key) => <div key={key} className="min-w-0">
        <dt className="text-xs leading-5 text-muted-foreground">{uiText.text(en, LABELS[key])}</dt>
        <dd className="mt-1 break-words font-number text-lg tabular-nums md:text-xl">{average?.[key] === undefined ? "—" : Math.round(average[key]!)}</dd>
      </div>)}</dl>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">{new Date(record.createdAt).toLocaleString(en)} · {record.sourceType === "screenshot" ? (uiText.text(en, "screenshot2")) : (uiText.text(en, "manual"))}</p>
    </div> : loading ? <p className="mt-4 text-xs leading-5 text-muted-foreground">{uiText.text(en, "loadingSavedReport")}</p> : null}
  </section>;
}
