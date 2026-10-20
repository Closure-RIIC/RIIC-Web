"use client";

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
import { prepareMaaForExport } from "@/maa-safety";
import { OPERATOR_CATALOG } from "@/operatorPortraits";
import { manualEditableRooms } from "@/recycling-room";
import { posterDataOnly, POSTER_MAX_BYTES, readPosterFile, type SchedulePosterDocument } from "@/schedule-poster-document";
import { posterRoomTitle } from "@/schedule-poster-model";
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
    if (bulkBase !== JSON.stringify([doc.layout, doc.draft])) { setBulkErrors(["排班已在其他位置修改，请点击“重新读取当前排班”后再填写。"]); return; }
    const parsed = applyScheduleText(bulkText, doc.layout, doc.draft, new Set(OPERATOR_CATALOG.map(operator => operator.name)));
    setBulkErrors(parsed.errors);
    if (parsed.errors.length) return;
    updateDraft(parsed.draft); setBulkOpen(false); setError("");
    setNotice(`已应用 ${parsed.changedRows} 行。排班编辑、心情回放和作业图使用同一份安排。`);
  }
  async function importFile(file: File) {
    try {
      if (file.size > POSTER_MAX_BYTES) throw new Error("作业文件不能超过 256 KB。");
      onImport(readPosterFile(await file.text())); setNotice(`已导入 ${file.name}，布局与班次已同步。`); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "导入失败。"); }
  }
  async function generateShare() {
    setSharing(true);
    try {
      const origin = new URL(shareOrigin);
      if (!["http:", "https:"].includes(origin.protocol)) throw new Error("分享地址必须是 http 或 https 网站。");
      const response = await fetch("/api/schedule-posters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(posterDataOnly(doc)) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error);
      const url = new URL("/manual", origin.origin); url.searchParams.set("tab", "poster"); url.searchParams.set("code", payload.code);
      setShare({ key: snapshotKey, code: payload.code, url: url.href }); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "生成失败。"); }
    finally { setSharing(false); }
  }
  async function openCode() {
    try {
      const code = codeInput.trim(); if (!/^[a-f0-9]{12}$/.test(code)) throw new Error("请输入 12 位作业码。");
      const response = await fetch(`/api/schedule-posters?code=${code}`); const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      const next = readPosterFile(JSON.stringify(payload.document)); onImport(next);
      setShare({ key: JSON.stringify(posterSnapshot(next)), code, url: `${window.location.origin}/manual?tab=poster&code=${code}` });
      setNotice("已读取作业并同步布局、班次和作业练度。"); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "读取失败。"); }
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
      await downloadCanvasImage(canvas, `${doc.meta.title || "排班作业"}.png`); setNotice("已导出 1920 × 1080 PNG。");
    } catch (e) { setError(e instanceof Error ? e.message : "导出失败。"); }
    finally { setExporting(false); }
  }
  function download() { try { downloadJson(`${doc.meta.title || "排班作业"}.riic.json`, posterDataOnly(doc)); } catch (e) { setError(String(e)); } }
  function downloadMaa() {
    try {
      const cycleHours = doc.draft.shifts.reduce((sum, shift) => sum + shift.durationHours, 0);
      const exportDraft = Math.abs(cycleHours - 24) > 0.001 && doc.draft.scheduleMode === "period"
        ? { ...doc.draft, scheduleMode: "sequential" as const }
        : doc.draft;
      const maa = prepareMaaForExport(manualScheduleToMaa(exportDraft, doc.layout, exportDraft.fiammettaEnabled));
      downloadJson(`${doc.meta.title || "排班作业"}.maa.json`, maa);
      setNotice(`${Math.abs(cycleHours - 24) > 0.001 ? "多日周期已按 MAA 顺序班次导出。" : ""}已导出 MAA 排班 JSON；标题、说明和海报设置仍保留在网站作业文件中。`);
    } catch (e) { setError(e instanceof Error ? e.message : "MAA 导出失败。"); }
  }
  return <div className="min-w-0 space-y-4" data-poster-workbench>
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" onClick={openBulk}><FileText />批量填写排班</Button>
      <Button variant="outline" onClick={() => fileInput.current?.click()}><Upload />导入作业文件</Button>
      <Button variant="outline" onClick={download} disabled={!supported}><Download />下载作业文件</Button>
      <Button variant="outline" onClick={downloadMaa} disabled={!supported}><Download />导出 MAA</Button>
      <Button variant="outline" onClick={() => void generateShare()} disabled={sharing || !supported}><Link2 />{sharing ? "生成中…" : "生成作业码"}</Button>
      <Button onClick={() => void exportImage()} disabled={exporting || !supported}><ImageDown />{exporting ? "导出中…" : "导出一页 PNG"}</Button>
      <input ref={fileInput} type="file" accept=".json" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = ""; }} />
    </div>
    <details className="border-y border-border py-3" open>
      <summary className="cursor-pointer text-sm font-medium">作业信息与班次</summary>
      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid gap-3">
          <div className="grid grid-cols-[2fr_1fr] gap-3"><Field title="作业名称"><Input value={doc.meta.title} maxLength={40} onChange={e => meta("title", e.target.value)} /></Field><Field title="作者"><Input value={doc.meta.author} maxLength={40} onChange={e => meta("author", e.target.value)} /></Field></div>
          <Field title="使用说明"><Textarea value={doc.meta.instructions} maxLength={240} onChange={e => meta("instructions", e.target.value)} /></Field>
          <label className="flex items-center gap-2 text-sm"><Switch checked={doc.presentation.showInstructions} onCheckedChange={showInstructions => onChange({ ...doc, presentation: { ...doc.presentation, showInstructions } })} />显示说明栏</label>
        </div>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">当前布局 {doc.layout.template}。设施布局与等级统一在「Box 与排班设置」中调整。</p>
          <div className="grid grid-cols-2 gap-3">
            <Field title="班次数"><Choice label="班次数" value={String(doc.draft.shifts.length)} options={[1, 2, 3, 4].map(count => ({ value: String(count), label: `${count} 班` }))} onChange={value => updateDraft(resizeManualScheduleDraft(doc.draft, Array.from({ length: Number(value) }, () => 24 / Number(value))))} /></Field>
            <div className="grid min-w-0 content-start gap-2 text-sm"><span className="text-muted-foreground">第一班开始时间</span><div className="flex min-w-0 gap-2"><Input type="time" aria-label="第一班开始时间" value={doc.draft.startTime} placeholder="默认 08:00" onChange={e => updateDraft({ ...doc.draft, startTime: e.target.value })} />{doc.draft.startTime ? <Button type="button" size="icon" variant="ghost" aria-label="清除第一班开始时间" title="清除后使用默认时间" onClick={() => updateDraft({ ...doc.draft, startTime: "" })}><X /></Button> : null}</div></div>
          </div>
          <div className="flex flex-wrap gap-3">{doc.draft.shifts.map((shift, index) => <div className="w-28" key={index}><Field title={`${index + 1} 班时长 / h`}><Input type="number" min={.25} max={24} step={.25} value={shift.durationHours} onChange={e => {
            const durations = doc.draft.shifts.map(item => item.durationHours); const value = Number(e.target.value);
            if (!Number.isFinite(value) || value < .25 || value > 24) return;
            durations[index] = value; updateDraft(resizeManualScheduleDraft(doc.draft, durations));
          }} /></Field></div>)}<p className="self-end pb-2 text-xs text-muted-foreground">轮换周期 {doc.draft.shifts.reduce((sum, shift) => sum + shift.durationHours, 0)} h</p></div>
          <Field title="产出计算"><Choice label="产出计算" value={doc.efficiencyMode} options={[{ value: "native", label: "干员 → 自动效率 → 自动产出" }, { value: "manual", label: "干员 + 手填技能效率 → 自动产出" }]} onChange={value => onChange({ ...doc, efficiencyMode: value as "native" | "manual" })} /></Field>
          <div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-sm"><Switch checked={auto} onCheckedChange={setAuto} />修改后自动计算</label><Button size="sm" variant="outline" disabled={pending} onClick={() => void onCalculate(doc.efficiencyMode).catch(e => setError(String(e)))}>{pending ? "正在计算…" : "重新计算"}</Button></div>
          <details className="text-xs leading-5 text-muted-foreground"><summary className="cursor-pointer">产出统计口径</summary><div className="mt-2 space-y-1">
            <p>贸易站分行显示纸面效率与等效效率：纸面是本设施技能效率；等效由订单产出折算为贸易与赤金两项。赤金项为特殊贸易额外产出的等效效率，鼠标停留可查看订单锚点、倍率和日产量折算。</p>
            <p>自动模式按作业练度及全站安排结算纸面技能效率；手填模式的 @90% 填写本设施技能效率，跨设施加成仍自动计算，未填技能按 0 处理。各班独立估算，未将心情回放中的停工或菲亚梅塔运行状态折入效率。</p>
            <p>产出按轮换周期折算到每日。无人机按各班发电效率与指定去向估算，未指定的班次不计增量；总量下方单列“其中无人机”。</p>
            <p>赤金价值 = 制造 + 无人机 + 隐含赤金。隐含赤金包括龙舌兰、可露希尔等技能的特殊贸易等效，以及基建外获取的赤金；基建外获取沿用本站每日 10 枚（价值 5,000）的固定估算。贸易等效不是实物赤金，也不会再次加到龙门币订单中。</p>
            <p>当前无人机统计支持龙门币订单、赤金和作战记录；源石碎片及合成玉的无人机增量暂未纳入。</p>
          </div></details>
        </div>
      </div>
    </details>
    <div className="flex flex-wrap gap-x-8 gap-y-3">
      <details className="min-w-64 flex-1"><summary className="cursor-pointer text-sm">背景与展示设施</summary><div className="mt-3 grid gap-3">
        <div className="flex flex-wrap gap-4">{manualEditableRooms(doc.layout).filter(room => ["workshop", "training_room", "recycling"].includes(room.kind)).map(room => <label key={room.id} className="flex items-center gap-2 text-sm"><Switch checked={!doc.presentation.hiddenFacilities.includes(room.id)} onCheckedChange={checked => onChange({ ...doc, presentation: { ...doc.presentation, hiddenFacilities: checked ? doc.presentation.hiddenFacilities.filter(id => id !== room.id) : [...doc.presentation.hiddenFacilities, room.id] } })} />展示{posterRoomTitle(room, doc.layout)}</label>)}</div>
        <p className="text-xs text-muted-foreground">隐藏仅影响图片，入驻安排仍参与计算。</p>
        <div className="flex flex-wrap items-center gap-3"><Field title="背景底色"><Input type="color" className="w-20" value={doc.presentation.backgroundColor} onChange={e => onChange({ ...doc, presentation: { ...doc.presentation, backgroundColor: e.target.value } })} /></Field><Field title="替换背景图片"><Input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { const file = e.target.files?.[0]; if (file) { if (file.size > 10 * 1024 * 1024) { setError("背景图请小于 10 MB。"); return; } setBackground(URL.createObjectURL(file)); } }} /></Field><Button variant="ghost" onClick={() => setBackground(null)}>清除背景</Button></div>
        <p className="text-xs text-muted-foreground">背景图片仅用于本次出图，作业文件保留排班数据。</p>
      </div></details>
      <details className="min-w-64 flex-1"><summary className="cursor-pointer text-sm">读取作业码与扫码地址</summary><div className="mt-3 grid gap-3"><Field title="扫码访问地址"><Input value={shareOrigin} onChange={e => { setShareOrigin(e.target.value); setShare(null); }} /></Field><p className="text-xs text-muted-foreground">二维码只记录访问网址和 12 位作业码，不包含完整作业；扫码后由网站读取服务器保存的完整作业。作业文件仍可离线保存和导入。</p><p className="text-xs text-muted-foreground">本地手机扫码请填写本机局域网地址，并连接同一网络。</p><div className="flex gap-2"><Input aria-label="作业码" placeholder="12 位作业码" value={codeInput} onChange={e => setCodeInput(e.target.value)} maxLength={12} /><Button variant="outline" onClick={() => void openCode()}>读取作业</Button></div></div></details>
    </div>
    {error ? <p role="alert" className="whitespace-pre-line text-sm text-destructive">{error}</p> : null}
    {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
    {supported ? <div ref={preview}><div className="mb-2 flex justify-between text-xs text-muted-foreground"><span>1920 × 1080 · 点击头像使用现有干员选择器</span><span>{pending ? "计算中…" : result ? "已计算" : "待计算"}</span></div><SchedulePoster document={doc} result={result} background={background} share={validShare} onSelect={onSelect} /></div> : <p className="border p-4 text-sm">单页作业图支持 1～4 个班次。当前排班已保留，可在上方调整班次数。</p>}
    {validShare ? <div className="flex flex-wrap items-center gap-3 border-y py-3 text-sm"><span>作业码 <strong className="font-mono">{validShare.code}</strong></span><Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(validShare.code).then(() => setNotice("已复制作业码。")).catch(() => setNotice("请手动选择并复制作业码。"))}>复制</Button><a className="break-all underline" href={validShare.url}>{validShare.url}</a><span className="text-xs text-muted-foreground">修改后需重新生成作业码。</span></div> : null}
    <Dialog open={bulkOpen} onOpenChange={setBulkOpen}><DialogContent className="flex max-h-[90svh] w-[96vw] flex-col sm:max-w-5xl">
      <DialogHeader><DialogTitle>批量填写设施与干员</DialogTitle><DialogDescription>每行一个设施，班次之间用 | 分隔。只修改需要更换的行，也可以整表粘贴。</DialogDescription></DialogHeader>
      <DialogBody className="min-h-0 space-y-3 overflow-auto">
        <p className="text-sm leading-6">干员之间用「、」分隔；<code>@90%</code> 填本设施技能效率，<code>@自动</code> 清除手填值；<code>#龙门币</code> 选择龙门商法订单，<code>#合成玉</code> 选择开采协力。<code>=</code> 沿用上一班，<code>-</code> 清空，<code>_</code> 留一个空位（训练室顺序为专精、协助）。</p>
        <p className="text-xs text-muted-foreground">特殊贸易等效由干员姓名、精英阶段和订单自动识别；但书、巫恋、龙舌兰、可露希尔等规则仅在龙门币订单下生效，巫恋与龙舌兰组合仅在 3 级贸易站生效。干员练度取当前 Box；Box 外的干员按图鉴最高练度作为示例，批量文本不能设置练度。要核对实际账号结果，请先在 Box 与排班设置中确认练度。填写 @效率 后选“手填技能效率”模式；@自动 只清除手填值，要按干员技能自动计算请切换上方的自动模式；手填模式下空白效率按 0 处理。未知姓名、重复入驻或超出设施容量会阻止应用。</p>
        <div className="overflow-x-auto"><Textarea aria-label="批量排班文本" value={bulkText} onChange={e => setBulkText(e.target.value)} spellCheck={false} wrap="off" className="h-[min(48vh,480px)] min-w-[760px] resize-y font-mono text-sm leading-8 [field-sizing:fixed]" /></div>
        {bulkErrors.length ? <div role="alert" className="space-y-1 text-sm text-destructive">{bulkErrors.map((message, index) => <p key={index}>{message}</p>)}</div> : null}
      </DialogBody><DialogFooter><Button variant="outline" onClick={openBulk}>重新读取当前排班</Button><Button variant="outline" onClick={() => setBulkOpen(false)}>取消</Button><Button onClick={applyBulk}>检查并应用</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
function posterSnapshot(doc: SchedulePosterDocument) { return { ...doc, draft: { ...doc.draft, activeShift: 0 } }; }
