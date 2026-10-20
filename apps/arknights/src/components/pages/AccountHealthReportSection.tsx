"use client";

import { useCallback, useEffect, useState } from "react";
import { ClipboardList, Upload } from "lucide-react";

import { getGameReport, postGameReport } from "@/api";
import { FileUploadDialog } from "@/components/FileUploadDialog";
import { SetupActionButton } from "@/components/setup/SetupActionButton";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GAME_REPORT_KEYS, gameReportAverage, parseGameReportDays, type GameReportRecord, type GameReportSource } from "@/game-report";
import { recognizeReport } from "@/report-recognition/recognize";
import { RECOGNITION_CONFIDENT_DISTANCE, type ReportMetricKey } from "@/report-recognition/types";

const LABELS: Record<ReportMetricKey, [string, string]> = {
  experience: ["作战记录经验", "EXP"],
  goldValue: ["贵金属价值", "Gold value"],
  lmd: ["龙门币贸易", "LMD trade"],
  orderCount: ["龙门币订单数量", "LMD orders"],
  orundum: ["合成玉", "Orundum"],
};
type Draft = Record<ReportMetricKey, string>;
const blankDay = (): Draft => ({ experience: "", goldValue: "", lmd: "", orderCount: "", orundum: "" });

export function AccountHealthReportSection({ en, authenticated, onRecordChange }: { en: boolean; authenticated: boolean; onRecordChange: (value: GameReportRecord | null) => void }) {
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
    } catch (cause) { setError(cause instanceof Error ? cause.message : (en ? "Could not load report" : "读取报表失败")); }
    finally { setLoading(false); }
  }, [authenticated, en, onRecordChange]);
  useEffect(() => { void load(); }, [load]);

  async function handleImage(file: File, signal: AbortSignal) {
    if (!file.type.startsWith("image/") || file.size > 15 * 1024 * 1024) throw new Error(en ? "Choose a PNG or JPEG under 15 MB." : "请选择小于 15 MB 的 PNG 或 JPEG 图片。");
    const bitmap = await createImageBitmap(file);
    try {
      if (signal.aborted) return;
      if (bitmap.width * bitmap.height > 16_000_000) throw new Error(en ? "Image is too large." : "图片像素过大。");
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error(en ? "Image cannot be decoded." : "无法解码图片。");
      context.drawImage(bitmap, 0, 0);
      const result = recognizeReport(context.getImageData(0, 0, bitmap.width, bitmap.height));
      if (signal.aborted) return;
      if ("ok" in result) {
        throw new Error(result.reason === "decode"
          ? (en ? "The image could not be decoded. Try exporting it as PNG or JPEG." : "图片无法解码，请重新导出为 PNG 或 JPEG 后重试。")
          : (en ? "Report panels were not found. Upload a complete screenshot." : "未找到简报面板，请上传包含三列简报面板的完整截图。"));
      }
      if (result.kind === "single-day") {
        setDraft([blankDay(), blankDay(), blankDay()]);
        setNotice(en ? "Please submit a three-day report." : "请提交三日报表。");
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
          else uncertain.push(`${index + 1}: ${en ? LABELS[key][1] : LABELS[key][0]}`);
        }
        return item;
      }) as [Draft, Draft, Draft];
      setDraft(next);
      setMode("screenshot");
      const reviewReason = file.type === "image/jpeg"
        ? (en ? "JPEG compression requires manual checking." : "JPEG 压缩可能影响数字，请人工核对空白项。")
        : result.warnings.includes("low-resolution")
          ? (en ? "The image is low resolution; check the blank fields." : "图片分辨率较低，请人工核对空白项。")
          : result.warnings.includes("odd-aspect-ratio")
            ? (en ? "This screenshot layout is not supported yet; check the blank fields." : "截图比例暂未匹配，请人工核对空白项。")
            : (en ? "Check the blank fields before saving." : "请核对空白项后再保存。");
      setNotice(uncertain.length || result.warnings.length || file.type === "image/jpeg"
        ? reviewReason
        : (en ? "Recognition complete. Check all values before saving." : "识别完成，请核对全部数值后保存。"));
      setError(null);
    } catch (cause) {
      if (!signal.aborted) {
        const message = cause instanceof Error ? cause.message : (en ? "Could not recognize the report image." : "报表图片识别失败，请检查图片后重试。");
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
        ? (en ? "Three-day report saved. Empty fields are excluded from the analysis." : "三日报表已保存，空白项不会参与统计。")
        : (en ? "Three-day report saved." : "三日报表已保存。"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : (en ? "Could not save report" : "保存报表失败")); }
    finally { setSaving(false); }
  }
  const average = record ? gameReportAverage(record.days) : null;

  return <section className="min-w-0 rounded-[4px] border border-border bg-card p-3 md:p-6" aria-labelledby="game-report-title" data-game-report-section>
    <h2 id="game-report-title" className="flex items-center gap-2 text-sm font-semibold"><ClipboardList className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />{en ? "Three-day base report" : "基建三日报表"}</h2>
    <Tabs value={mode} onValueChange={(value) => setMode(value as GameReportSource)} className="mt-4 min-w-0 max-md:[&_[data-slot=tabs-list]]:w-full max-md:[&_[data-slot=tabs-trigger]]:min-h-11 max-md:[&_[data-slot=tabs-trigger]]:min-w-0 max-md:[&_[data-slot=tabs-trigger]]:text-xs">
      <TabsList aria-label={en ? "Report entry method" : "报表录入方式"}><TabsTrigger value="screenshot">{en ? "Screenshot" : "上传截图识别"}</TabsTrigger><TabsTrigger value="manual">{en ? "Manual" : "手动填写"}</TabsTrigger></TabsList>
      <TabsContent value="screenshot" className="pt-3 md:pt-4"><FileUploadDialog title={en ? "Upload base report" : "上传基建三日报表"} description={en ? "Use a complete, original screenshot." : "请上传完整原图。"} extensions={[".png", ".jpg", ".jpeg"]} onFiles={([file], signal) => handleImage(file!, signal)} trigger={<SetupActionButton type="button" variant="outline"><Upload aria-hidden="true" />{en ? "Choose screenshot" : "选择截图"}</SetupActionButton>} /></TabsContent>
      <TabsContent value="manual" className="pt-3 md:pt-4"><p className="text-xs leading-5 text-muted-foreground">{en ? "Enter the three days from left to right, oldest first. Empty fields may be left blank." : "按游戏画面从左到右填写三天数据，最右侧为最新一天；未填写项可以留空。"}</p></TabsContent>
    </Tabs>
    {notice ? <p className="mt-3 text-sm text-amber-700 dark:text-amber-300" role="status">{notice}</p> : null}
    {error ? <p className="mt-3 text-sm text-destructive" role="alert">{error}</p> : null}
    <div className="mt-4 min-w-0">
      <table className="w-full table-fixed border-collapse text-xs md:text-sm">
        <colgroup><col className="w-[31%] sm:w-[28%]" /><col /><col /><col /></colgroup>
        <thead><tr className="border-y border-border text-muted-foreground">
          <th scope="col" className="py-3 pr-2 text-left font-medium">{en ? "Metric" : "指标"}</th>
          {[0, 1, 2].map((day) => <th key={day} scope="col" className="px-1 py-3 text-center font-medium md:px-2">{en ? `Day ${day + 1}` : `第 ${day + 1} 天`}</th>)}
        </tr></thead>
        <tbody>{GAME_REPORT_KEYS.map((key) => <tr key={key} className="border-b border-border/60 last:border-b-0">
          <th scope="row" className="break-words py-2 pr-2 text-left font-normal leading-5 text-muted-foreground">{en ? LABELS[key][1] : LABELS[key][0]}</th>
          {draft.map((day, index) => <td key={index} className="px-1 py-2 md:px-2">
            <Input inputMode="numeric" pattern="[0-9]*" value={day[key]} onChange={(event) => update(index, key, event.target.value)} aria-label={`${en ? LABELS[key][1] : LABELS[key][0]} ${en ? `day ${index + 1}` : `第 ${index + 1} 天`}`} className="h-11 min-w-0 px-1 text-center font-number text-xs tabular-nums md:h-9 md:px-3 md:text-sm" />
          </td>)}
        </tr>)}</tbody>
      </table>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
      <SetupActionButton type="button" disabled={!parsed || saving || !authenticated} onClick={() => void save()}>{saving ? (en ? "Saving…" : "保存中…") : (en ? "Confirm and save" : "确认并保存")}</SetupActionButton>
      {parsed && hasBlankFields ? <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">{en ? "Blank fields will be skipped." : "空白项会跳过，不影响保存。"}</p> : null}
      {!authenticated ? <p className="text-xs leading-5 text-muted-foreground">{en ? "Sign in to save this report." : "登录网站账号后可保存报表。"}</p> : null}
    </div>
    {record ? <div className="mt-5 border-t border-border pt-4" data-game-report-average>
      <p className="text-sm font-medium">{en ? "Latest saved report · daily average" : "最近保存的报表 · 三日日均"}</p>
      <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">{GAME_REPORT_KEYS.map((key) => <div key={key} className="min-w-0">
        <dt className="text-xs leading-5 text-muted-foreground">{en ? LABELS[key][1] : LABELS[key][0]}</dt>
        <dd className="mt-1 break-words font-number text-lg tabular-nums md:text-xl">{average?.[key] === undefined ? "—" : Math.round(average[key]!)}</dd>
      </div>)}</dl>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">{new Date(record.createdAt).toLocaleString(en ? "en-US" : "zh-CN")} · {record.sourceType === "screenshot" ? (en ? "Screenshot" : "截图识别") : (en ? "Manual" : "手动填写")}</p>
    </div> : loading ? <p className="mt-4 text-xs leading-5 text-muted-foreground">{en ? "Loading saved report…" : "正在读取已存报表…"}</p> : null}
  </section>;
}
