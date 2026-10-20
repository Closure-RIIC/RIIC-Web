"use client";
import { useAdminFetch, useAdminHref } from "../admin-context";
import { adminPageClass } from "../admin-page";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "@/navigation";
import { Link } from "@tanstack/react-router";
import { AlertCircle, CheckCircle2, FlaskConical, Loader2, Play, RefreshCw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileUploadDialog } from "@/components/FileUploadDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { PRESETS } from "@/blueprint";
import { ROTATION_OPTIONS, rotationDescription } from "@/rotation-settings";
import { parseReproductionPackage, reproductionInputKey, type ReproductionPackage } from "@/reproduction-package";
import { QUALITY_CASE_LIMIT, type QualityDraftData, type QualityBatchData, type QualityVersion } from "@/quality";
import type { ApiResponse } from "@/types";
import { DraftEditor } from "./draft-editor";
import { BatchDetails, ResultPanel } from "./quality-results";
import { Check, Choice, dateText, Panel, Status, useWorkbenchText, versionText } from "./workbench-ui";

type PreviewEntry = { id: string; name: string; error: string | null };
type Overview = { versions: QualityVersion[]; batches: Omit<QualityBatchData, "cases">[]; drafts: Omit<QualityDraftData, "input" | "original">[]; isAdmin: boolean; worker: { at: string; syncError?: string } | null };

export function QualityWorkbench() {
  const request = useAdminFetch();
  const adminHref = useAdminHref();
  const api = useCallback(async <T,>(query = "", body?: unknown): Promise<T> => {
    const response = await request(`/api/admin/quality${query}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
    const envelope = await response.json() as ApiResponse<T>;
    if (!envelope.success) throw new Error(envelope.error.message);
    return envelope.data;
  }, [request]);
  const { en, t } = useWorkbenchText();
  const params = useSearchParams();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [draft, setDraft] = useState<QualityDraftData | null>(null);
  const [input, setInput] = useState<ReproductionPackage | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<PreviewEntry[]>([]);
  const [previewToken, setPreviewToken] = useState("");
  const [excluded, setExcluded] = useState<string[]>([]);
  const [preset, setPreset] = useState("");
  const [uploadRotation, setUploadRotation] = useState("");
  const [uploadFiammetta, setUploadFiammetta] = useState(false);
  const [candidate, setCandidate] = useState("");
  const [baseline, setBaseline] = useState("");
  const [label, setLabel] = useState("");
  const [batch, setBatch] = useState<QualityBatchData | null>(null);
  const [result, setResult] = useState<{ data: unknown; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [checkedAt, setCheckedAt] = useState(0);
  const versionsInitialized = useRef(false);
  const historySection = useRef<HTMLDivElement>(null);
  const batchSection = useRef<HTMLDivElement>(null);
  const resultSection = useRef<HTMLDivElement>(null);
  const [batchNavigation, setBatchNavigation] = useState(0);
  function reveal(element: HTMLElement | null) {
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: "start" });
  }
  useEffect(() => { if (batchNavigation) reveal(batchSection.current); }, [batchNavigation]);
  useEffect(() => { if (result) reveal(resultSection.current); }, [result]);
  const dirty = !!draft && !!input && reproductionInputKey(input) !== reproductionInputKey(draft.input);
  const refresh = useCallback(async () => {
    const data = await api<Overview>();
    setOverview(data); setCheckedAt(Date.now());
    if (!versionsInitialized.current && data.versions.length) {
      setCandidate(data.versions[0].id); setBaseline(data.versions[1]?.id ?? ""); versionsInitialized.current = true;
    } else if (versionsInitialized.current) {
      setCandidate(current => data.versions.some(version => version.id === current) ? current : data.versions[0]?.id ?? "");
      setBaseline(current => data.versions.some(version => version.id === current) ? current : "");
    }
  }, [api]);
  useEffect(() => { void refresh().catch((error: Error) => setError(error.message)); const timer = setInterval(() => { void refresh().catch((error: Error) => setError(error.message)); }, 5000); return () => clearInterval(timer); }, [refresh]);
  const draftId = params.get("draft");
  const draftIds = params.get("drafts");
  useEffect(() => { if (draftIds) setSelected(draftIds.split(",").filter(Boolean)); }, [draftIds]);
  useEffect(() => {
    if (!draftId) return;
    let active = true;
    void api<QualityDraftData>(`?kind=draft&id=${encodeURIComponent(draftId)}`).then(data => { if (active) { setDraft(data); setInput(data.input); setSelected([data.id]); } }).catch((error: Error) => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [draftId, api]);
  const batchId = batch?.id;
  const batchStatus = batch?.status;
  useEffect(() => {
    if (!batchId || !["queued", "running"].includes(batchStatus ?? "")) return;
    let active = true;
    const timer = setInterval(() => { void api<QualityBatchData>(`?kind=batch&id=${batchId}`).then(data => { if (active) setBatch(data); }).catch((error: Error) => { if (active) setError(error.message); }); }, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [batchId, batchStatus, api]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (error) { setError(error instanceof Error ? error.message : t("请求未完成，请重试。", "The request could not be completed. Try again.")); }
    finally { setBusy(false); }
  }
  function clearPreview() { setPreview([]); setPreviewToken(""); setExcluded([]); }
  async function previewFiles() {
    clearPreview();
    const form = new FormData(); files.forEach(file => form.append("files", file));
    if (preset && uploadRotation) form.set("settings", JSON.stringify({ layout: PRESETS.find(entry => entry.label === preset)!.layout, rotation: uploadRotation, fiammetta_enable: uploadFiammetta }));
    const response = await request("/api/admin/quality/import", { method: "POST", body: form });
    const body = await response.json() as ApiResponse<{ entries: PreviewEntry[]; token: string }>;
    if (!body.success) throw new Error(body.error.message);
    setPreview(body.data.entries); setPreviewToken(body.data.token);
  }
  async function acceptPreview() {
    const ids = (await api<{ id: string }[]>("", { action: "acceptImport", token: previewToken, excluded })).map(draft => draft.id);
    await refresh(); setSelected(ids); clearPreview(); setFiles([]);
    setNotice(t(`已导入并选中 ${ids.length} 份草稿。选择测试版本后即可开始。`, `Imported and selected ${ids.length} drafts. Choose a test version to run them.`));
  }
  const included = preview.filter(entry => !excluded.includes(entry.id));
  const invalid = included.filter(entry => entry.error).length;
  const missingDrafts = !!overview && selected.some(id => !overview.drafts.some(draft => draft.id === id));
  const runReason = !overview ? t("正在加载可用版本与草稿…", "Loading versions and drafts…") : !selected.length ? t("请先从团队草稿中选择至少一项。", "Select at least one team draft first.") : missingDrafts ? t("部分已选草稿已到期，请重新选择。", "Some selected drafts have expired. Select them again.") : dirty ? t("当前草稿有未保存的修改，请先保存或放弃修改。", "Save or discard the current draft's changes before running.") : !candidate ? t("暂无可用求解器版本，请联系管理员同步生产版本。", "No solver version is available. Ask an administrator to sync production.") : baseline === candidate ? t("对比版本需要与测试版本不同，或选择单版本测试。", "Choose a different comparison version, or run a single-version test.") : "";
  const workerReady = !!overview?.worker && checkedAt - Date.parse(overview.worker.at) < 15000;
  const versionOptions = overview?.versions.map((version, index) => ({ value: version.id, label: versionText(version, index, en) })) ?? [];
  return <main id="admin-content" className={adminPageClass}>
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="flex items-center gap-2 text-2xl font-semibold"><FlaskConical aria-hidden="true" className="size-6" />{t("复现测试工作台", "Reproduction workbench")}</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t("导入或选择复现草稿，运行测试，再回到反馈记录处理结论。", "Import or select reproduction drafts, run tests, then record your findings on the source feedback.")}</p></div><Link className="text-sm underline underline-offset-4" to={adminHref("/admin/issues")}>{t("返回反馈审阅", "Back to feedback review")}</Link></header>
    {error && <Alert variant="destructive"><AlertCircle aria-hidden="true" /><AlertTitle>{t("操作未完成", "Action not completed")}</AlertTitle><AlertDescription className="break-words">{error}</AlertDescription></Alert>}
    <div className="flex flex-wrap items-center gap-3"><Button variant="outline" onClick={() => reveal(historySection.current)}>{t("查看测试结果", "View test results")}{overview ? `（${overview.batches.length}）` : ""}</Button><p className="text-sm text-muted-foreground">{t("已运行的测试都保存在测试记录中，点击批次查看排班、收益或失败原因。", "Find previous runs in test history. Open a batch to see schedules, revenue, or failure details.")}</p></div>
    {notice && <Alert role="status"><CheckCircle2 aria-hidden="true" /><AlertDescription>{notice}</AlertDescription></Alert>}
    {!overview && !error && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 aria-hidden="true" className="size-4 motion-safe:animate-spin" />{t("正在加载团队草稿和测试记录…", "Loading team drafts and test history…")}</p>}
    <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid min-w-0 gap-6">
        <Panel title={t("1. 准备复现用例", "1. Prepare reproductions")} description={t("支持完整复现包、box JSON 和 ZIP。完整复现包会保留文件中的设置。", "Upload reproduction packages, box JSON files or ZIP archives. Complete packages retain their own settings.")}>
          <fieldset disabled={busy || !overview} className="grid min-w-0 gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-dashed p-4">
              <FileUploadDialog
                title={t("选择 JSON 或 ZIP 文件", "Choose JSON or ZIP files")}
                description={t("选择后可在工作台预览导入内容。新的一批文件会替换当前选择。", "After choosing files, preview them in the workbench. A new batch replaces your current selection.")}
                extensions={[".json", ".zip"]}
                multiple
                maxFiles={QUALITY_CASE_LIMIT}
                disabled={busy || !overview}
                onFiles={nextFiles => { setFiles(nextFiles); clearPreview(); }}
                trigger={<Button type="button" variant="outline"><Upload aria-hidden="true" />{t("选择文件", "Choose files")}</Button>}
              >
                <p className="text-xs text-muted-foreground">{t("每批最多 500 个用例；每个 JSON 不超过 2 MiB，解压后合计不超过 100 MiB。", "Up to 500 cases per batch; each JSON up to 2 MiB, with 100 MiB total after extraction.")}</p>
              </FileUploadDialog>
              <span className="min-w-0 flex-1 break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">{files.length ? t(`已选择 ${files.length} 个文件：${files.map(file => file.name).join("、")}`, `${files.length} files selected: ${files.map(file => file.name).join(", ")}`) : t("可一次选择多个 JSON 或 ZIP 文件", "Select one or more JSON or ZIP files")}</span>
            </div>
            <p id="import-limits" className="text-xs text-muted-foreground">{t("每批最多 500 个用例；每个 JSON 不超过 2 MiB，解压后合计不超过 100 MiB。", "Up to 500 cases per batch; each JSON up to 2 MiB, with 100 MiB total after extraction.")}</p>
            <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">{t("只有 box？先补充复现设置", "Box-only file? Set up the reproduction first")}</summary><p className="mt-2 text-xs text-muted-foreground">{t("以下设置仅用于纯 box 文件。修改后请重新预览文件。", "These settings apply only to box arrays. Preview again after changing them.")}</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2"><Choice label={t("布局", "Layout")} value={preset} options={[{ value: "", label: t("请选择布局", "Choose a layout") }, ...PRESETS.map(p => ({ value: p.label, label: p.label }))]} onChange={value => { setPreset(value); clearPreview(); }} />
                <Choice label={t("轮换方案", "Rotation")} value={uploadRotation} options={[{ value: "", label: t("请选择轮换方案", "Choose a rotation") }, ...ROTATION_OPTIONS.map(option => ({ value: option.profile, label: rotationDescription(option.profile, en) }))]} onChange={value => { setUploadRotation(value); clearPreview(); }} /></div>
              <Check label={t("启用菲亚梅塔回满心情", "Enable Fiammetta morale recovery")} checked={uploadFiammetta} onChange={value => { setUploadFiammetta(value); clearPreview(); }} />
            </details>
            <Button className="justify-self-start" variant="outline" disabled={busy || !files.length} onClick={() => void perform(previewFiles)}><Upload aria-hidden="true" />{t("预览导入内容", "Preview import")}{!!files.length && ` (${files.length})`}</Button>
          </fieldset>
          {!!preview.length && <div className="grid gap-3 border-t pt-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">{t(`导入预览 · ${included.length - invalid} 项可导入`, `Import preview · ${included.length - invalid} ready`)}</h3><span className="text-xs text-muted-foreground">{t(`已排除 ${excluded.length} 项`, `${excluded.length} excluded`)}</span></div>
            <div data-yeye-scroll="auto" className="max-h-72 overflow-y-auto"><ul className="divide-y">{preview.map(entry => <li key={entry.id} className="flex items-start gap-3 py-3"><Check label={t("排除", "Exclude")} disabled={busy} checked={excluded.includes(entry.id)} onChange={checked => setExcluded(current => checked ? [...current, entry.id] : current.filter(id => id !== entry.id))} /><div className="min-w-0 flex-1 text-sm"><p className="break-all font-medium">{entry.name}</p><p className={entry.error ? "mt-1 break-words text-destructive" : "mt-1 text-muted-foreground"}>{entry.error ?? t("设置完整，可导入", "Ready to import")}</p></div></li>)}</ul></div>
            {!!invalid && <p className="text-sm text-destructive">{t(`还有 ${invalid} 项无法导入。修正文件后重新预览，或勾选“排除”。`, `${invalid} entries need attention. Fix and preview again, or check Exclude.`)}</p>}
            <Button className="justify-self-start" disabled={busy || !included.length || !!invalid} onClick={() => void perform(acceptPreview)}>{t(`导入 ${included.length} 项并选中`, `Import and select ${included.length} entries`)}</Button>
          </div>}
        </Panel>
        <Panel title={t("团队草稿", "Team drafts")} description={t("勾选要运行的草稿；点击名称可查看或调整复现条件。", "Select drafts to run. Open a name to review or edit its inputs.")}>
          {overview && !overview.drafts.length ? <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">{t("还没有复现草稿。上传文件，或在反馈详情中选择“一键复现”。", "No drafts yet. Upload a file or reproduce an issue from feedback details.")}</div> : <>
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm">{t(`已选 ${selected.length} 项`, `${selected.length} selected`)}</span><div className="flex gap-1"><Button size="sm" variant="ghost" disabled={busy || !overview?.drafts.length} onClick={() => setSelected(overview!.drafts.map(draft => draft.id))}>{t("全选", "Select all")}</Button><Button size="sm" variant="ghost" disabled={busy || !selected.length} onClick={() => setSelected([])}>{t("清空选择", "Clear selection")}</Button></div></div>
            {dirty && <p className="text-xs text-muted-foreground">{t("请保存或放弃当前修改后再打开其他草稿。", "Save or discard your changes before opening another draft.")}</p>}
            <div data-yeye-scroll="auto" className="max-h-80 overflow-y-auto"><ul className="divide-y">{overview?.drafts.map(entry => <li key={entry.id} className="flex items-center gap-3 py-3"><Check label={t("选择", "Select")} checked={selected.includes(entry.id)} disabled={busy} onChange={checked => setSelected(current => checked ? [...new Set([...current, entry.id])] : current.filter(id => id !== entry.id))} /><div className="min-w-0 flex-1"><button className="w-full break-words text-left text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50" disabled={busy || dirty} onClick={() => void perform(async () => { const next = await api<QualityDraftData>(`?kind=draft&id=${entry.id}`); setDraft(next); setInput(next.input); })}>{entry.sources.map(source => source.name).join(" · ") || t("复现草稿", "Reproduction draft")}</button><p className="mt-1 text-xs text-muted-foreground">{t(`第 ${entry.revision} 版 · 到期时间 `, `Revision ${entry.revision} · Expires `)}{dateText(entry.expiresAt, en)}</p></div>{entry.id === draft?.id && <Badge variant="secondary">{t("编辑中", "Editing")}</Badge>}</li>)}</ul></div>
          </>}
        </Panel>
        {draft && input && <DraftEditor draft={draft} input={input} setInput={setInput} busy={busy} onSave={() => void perform(async () => { const next = await api<QualityDraftData>("", { action: "edit", id: draft.id, revision: draft.revision, input: parseReproductionPackage(input) }); setDraft(next); setInput(next.input); setSelected(current => [...new Set([...current, next.id])]); await refresh(); setNotice(t("草稿已保存并选中。可在“运行测试”中开始测试。", "Draft saved and selected. Start it from Run tests.")); })} />}
      </div>
      <div className="min-w-0 lg:sticky lg:top-6"><Panel title={t("2. 运行测试", "2. Run tests")} description={t("已保存的草稿会加入后台队列，关闭页面后仍会继续运行。", "Saved drafts run in the background, even after you close this page.")}>
        <div className="flex flex-wrap items-center justify-between gap-2"><Badge variant="secondary">{t(`已选 ${selected.length} 项`, `${selected.length} selected`)}</Badge><span className="text-xs text-muted-foreground">{!overview ? t("正在检查服务…", "Checking service…") : workerReady ? t("测试服务就绪", "Test service ready") : t("等待测试服务", "Waiting for test service")}</span></div>
        {overview && !workerReady && <p className="text-xs text-muted-foreground">{t("可以提交，任务将在测试服务恢复后运行。", "You can queue tests now. They will run when the service is available.")}</p>}
        {overview?.worker?.syncError && <Alert variant="destructive"><AlertTitle>{t("生产版本同步失败", "Production sync failed")}</AlertTitle><AlertDescription>{t("已有版本仍可运行。管理员可重试同步。", "Existing versions remain available. An administrator can retry the sync.")}<details className="mt-2"><summary>{t("查看原因", "Show reason")}</summary><p className="break-all">{overview.worker.syncError}</p></details></AlertDescription></Alert>}
        <div className="grid gap-2"><Label htmlFor="batch-name">{t("批次名称（选填）", "Batch name (optional)")}</Label><Input id="batch-name" value={label} maxLength={120} disabled={busy} placeholder={t("例如：贸易站反馈复查", "e.g. Trading Post feedback check")} onChange={e => setLabel(e.target.value)} /></div>
        <Choice label={t("测试版本", "Test version")} value={candidate} options={versionOptions.length ? versionOptions : [{ value: "", label: t("暂无可用版本", "No versions available") }]} onChange={setCandidate} disabled={busy || !versionOptions.length} />
        <Choice label={t("对比方式", "Compare against")} value={baseline} options={[{ value: "", label: t("不对比，仅测试所选版本", "None — test selected version only") }, ...versionOptions]} onChange={setBaseline} disabled={busy || !versionOptions.length} />
        {overview?.versions.length === 1 && <p className="text-xs text-muted-foreground">{t("目前只有一个生产版本，可以先运行单版本测试。", "Only one production version is available. You can run a single-version test.")}</p>}
        {runReason && <p id="run-reason" className="text-sm text-muted-foreground">{runReason}</p>}
        <Button disabled={busy || !!runReason} aria-describedby={runReason ? "run-reason" : undefined} onClick={() => void perform(async () => { const next = await api<QualityBatchData>("", { action: "batch", ids: selected, bundleIds: baseline ? [baseline, candidate] : [candidate], label: label.trim() || t("反馈复现测试", "Feedback reproduction test") }); setBatch(next); setResult(null); setBatchNavigation(current => current + 1); await refresh(); setNotice(t("测试已加入后台队列。完成后，点击用例的“查看结果”查看排班与收益。", "Tests are queued. When finished, choose View result on a case to see its schedule and revenue.")); })}>{busy ? <Loader2 aria-hidden="true" className="motion-safe:animate-spin" /> : <Play aria-hidden="true" />}{t(`开始测试${selected.length ? `（${selected.length} 项）` : ""}`, `Run tests${selected.length ? ` (${selected.length})` : ""}`)}</Button>
        <p className="text-xs text-muted-foreground">{t("按顺序运行，每个用例最多 10 分钟。测试结果不会自动修改反馈状态。", "Cases run one at a time, up to 10 minutes each. Results do not change feedback status automatically.")}</p>
        {overview?.isAdmin && <details className="border-t pt-3"><summary className="cursor-pointer text-sm text-muted-foreground">{t("管理求解器版本", "Manage solver versions")}</summary><p className="my-3 text-xs text-muted-foreground">{t("从已发布的生产版本同步，校验完成后可用于新批次。运行中的批次不受影响。", "Sync a published production version. It becomes available after verification; existing batches keep their selected versions.")}</p><Button variant="outline" disabled={busy} onClick={() => void perform(async () => { await api("", { action: "sync" }); setNotice(t("已请求同步生产版本。校验完成后，版本列表会自动更新。", "Production sync requested. The version list will update after verification.")); })}><RefreshCw aria-hidden="true" />{t("同步生产版本", "Sync production version")}</Button></details>}
      </Panel></div>
    </div>
    <div ref={historySection} tabIndex={-1} className="scroll-mt-6 rounded-lg focus-visible:outline-2 focus-visible:outline-ring"><Panel title={t("3. 测试记录与结果", "3. Test history and results")} description={t("打开批次，再点击用例的“查看结果”查看排班、收益和失败原因。团队成员共享这些记录。", "Open a batch, then choose View result on a case to see its schedule, revenue, and failure details. These records are shared with the team.")}>
      {overview && !overview.batches.length && <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">{t("还没有测试记录。选择草稿和版本后，点击“开始测试”。", "No test runs yet. Select drafts and a version, then choose Run tests.")}</p>}
      <div data-yeye-scroll="auto" className="grid max-h-80 gap-2 overflow-y-auto">{overview?.batches.map(item => <button key={item.id} disabled={busy} aria-pressed={batch?.id === item.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring aria-pressed:border-primary aria-pressed:bg-muted/50 disabled:opacity-50" onClick={() => void perform(async () => { setBatch(await api(`?kind=batch&id=${item.id}`)); setResult(null); setBatchNavigation(current => current + 1); })}><span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{item.label}</span><span className="mt-1 block text-xs text-muted-foreground">{dateText(item.createdAt, en)} · {item.bundleIds.length === 2 ? t("双版本对比", "Two-version comparison") : t("单版本测试", "Single-version test")}</span></span><Status status={item.status} /><span className="text-sm font-medium text-primary">{["queued", "running"].includes(item.status) ? t("查看进度 →", "View progress →") : t("查看结果 →", "View results →")}</span></button>)}</div>
    </Panel></div>
    {batch && <div ref={batchSection} tabIndex={-1} className="scroll-mt-6 rounded-lg focus-visible:outline-2 focus-visible:outline-ring"><BatchDetails batch={batch} busy={busy} onAction={action => void perform(async () => { await api("", { action, id: batch.id }); setBatch(await api(`?kind=batch&id=${batch.id}`)); await refresh(); })} onResult={(attempt, name) => void perform(async () => setResult({ data: await api(`?kind=result&id=${batch.id}&attempt=${attempt}`), name }))} /></div>}
    {result && <div ref={resultSection} tabIndex={-1} className="min-w-0 scroll-mt-6 rounded-lg focus-visible:outline-2 focus-visible:outline-ring"><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><p className="min-w-0 break-words text-sm text-muted-foreground">{batch?.label} · {result.name}</p><Button variant="outline" onClick={() => reveal(batchSection.current)}>{t("返回批次用例", "Back to batch cases")}</Button></div><ResultPanel result={result.data} name={result.name} versions={overview?.versions ?? []} /></div>}
  </main>;
}
