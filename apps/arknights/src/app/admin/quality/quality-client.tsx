"use client";
import { useTranslations } from "use-intl";
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
import { PRESETS } from "@riic/arknights-domain/blueprint";
import { ROTATION_OPTIONS, rotationDescription } from "@riic/arknights-domain/rotation-settings";
import { parseReproductionPackage, reproductionInputKey, type ReproductionPackage } from "@riic/arknights-domain/reproduction-package";
import { QUALITY_CASE_LIMIT, type QualityDraftData, type QualityBatchData, type QualityVersion } from "@riic/arknights-domain/quality";
import type { ApiResponse } from "@riic/arknights-domain/types";
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
  const { en } = useWorkbenchText();
  const t = useTranslations("QualityWorkbench");
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
    try { await action(); } catch (error) { setError(error instanceof Error ? error.message : t("theRequestCouldNotBeCompletedTryAgain")); }
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
    setNotice(t("importedAndSelectedDraftsChooseATestVersion", { value1: ids.length }));
  }
  const included = preview.filter(entry => !excluded.includes(entry.id));
  const invalid = included.filter(entry => entry.error).length;
  const missingDrafts = !!overview && selected.some(id => !overview.drafts.some(draft => draft.id === id));
  const runReason = !overview ? t("loadingVersionsAndDrafts") : !selected.length ? t("selectAtLeastOneTeamDraftFirst") : missingDrafts ? t("someSelectedDraftsHaveExpiredSelectThemAgain") : dirty ? t("saveOrDiscardTheCurrentDraftSChanges") : !candidate ? t("noSolverVersionIsAvailableAskAnAdministrator") : baseline === candidate ? t("chooseADifferentComparisonVersionOrRunA") : "";
  const workerReady = !!overview?.worker && checkedAt - Date.parse(overview.worker.at) < 15000;
  const versionOptions = overview?.versions.map((version, index) => ({ value: version.id, label: versionText(version, index, en) })) ?? [];
  return <main id="admin-content" className={adminPageClass}>
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="flex items-center gap-2 text-2xl font-semibold"><FlaskConical aria-hidden="true" className="size-6" />{t("reproductionWorkbench")}</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t("importOrSelectReproductionDraftsRunTestsThen")}</p></div><Link className="text-sm underline underline-offset-4" to={adminHref("/admin/issues")}>{t("backToFeedbackReview")}</Link></header>
    {error && <Alert variant="destructive"><AlertCircle aria-hidden="true" /><AlertTitle>{t("actionNotCompleted")}</AlertTitle><AlertDescription className="break-words">{error}</AlertDescription></Alert>}
    <div className="flex flex-wrap items-center gap-3"><Button variant="outline" onClick={() => reveal(historySection.current)}>{t("viewTestResults")}{overview ? `（${overview.batches.length}）` : ""}</Button><p className="text-sm text-muted-foreground">{t("findPreviousRunsInTestHistoryOpenA")}</p></div>
    {notice && <Alert role="status"><CheckCircle2 aria-hidden="true" /><AlertDescription>{notice}</AlertDescription></Alert>}
    {!overview && !error && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 aria-hidden="true" className="size-4 motion-safe:animate-spin" />{t("loadingTeamDraftsAndTestHistory")}</p>}
    <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid min-w-0 gap-6">
        <Panel title={t("step1PrepareReproductions")} description={t("uploadReproductionPackagesBoxJsonFilesOrZip")}>
          <fieldset disabled={busy || !overview} className="grid min-w-0 gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-dashed p-4">
              <FileUploadDialog
                title={t("chooseJsonOrZipFiles")}
                description={t("afterChoosingFilesPreviewThemInTheWorkbench")}
                extensions={[".json", ".zip"]}
                multiple
                maxFiles={QUALITY_CASE_LIMIT}
                disabled={busy || !overview}
                onFiles={nextFiles => { setFiles(nextFiles); clearPreview(); }}
                trigger={<Button type="button" variant="outline"><Upload aria-hidden="true" />{t("chooseFiles")}</Button>}
              >
                <p className="text-xs text-muted-foreground">{t("upTo500CasesPerBatchEachJson")}</p>
              </FileUploadDialog>
              <span className="min-w-0 flex-1 break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">{files.length ? t("filesSelected", { count: files.length, names: new Intl.ListFormat(en).format(files.map(file => file.name)) }) : t("selectOneOrMoreJsonOrZipFiles")}</span>
            </div>
            <p id="import-limits" className="text-xs text-muted-foreground">{t("upTo500CasesPerBatchEachJson")}</p>
            <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">{t("boxOnlyFileSetUpTheReproductionFirst")}</summary><p className="mt-2 text-xs text-muted-foreground">{t("theseSettingsApplyOnlyToBoxArraysPreview")}</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2"><Choice label={t("layout")} value={preset} options={[{ value: "", label: t("chooseALayout") }, ...PRESETS.map(p => ({ value: p.label, label: p.label }))]} onChange={value => { setPreset(value); clearPreview(); }} />
                <Choice label={t("rotation")} value={uploadRotation} options={[{ value: "", label: t("chooseARotation") }, ...ROTATION_OPTIONS.map(option => ({ value: option.profile, label: rotationDescription(option.profile, en) }))]} onChange={value => { setUploadRotation(value); clearPreview(); }} /></div>
              <Check label={t("enableFiammettaMoraleRecovery")} checked={uploadFiammetta} onChange={value => { setUploadFiammetta(value); clearPreview(); }} />
            </details>
            <Button className="justify-self-start" variant="outline" disabled={busy || !files.length} onClick={() => void perform(previewFiles)}><Upload aria-hidden="true" />{t("previewImport")}{!!files.length && ` (${files.length})`}</Button>
          </fieldset>
          {!!preview.length && <div className="grid gap-3 border-t pt-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">{t("importPreviewReady", { value1: included.length - invalid })}</h3><span className="text-xs text-muted-foreground">{t("excluded", { value1: excluded.length })}</span></div>
            <div data-yeye-scroll="auto" className="max-h-72 overflow-y-auto"><ul className="divide-y">{preview.map(entry => <li key={entry.id} className="flex items-start gap-3 py-3"><Check label={t("exclude")} disabled={busy} checked={excluded.includes(entry.id)} onChange={checked => setExcluded(current => checked ? [...current, entry.id] : current.filter(id => id !== entry.id))} /><div className="min-w-0 flex-1 text-sm"><p className="break-all font-medium">{entry.name}</p><p className={entry.error ? "mt-1 break-words text-destructive" : "mt-1 text-muted-foreground"}>{entry.error ?? t("readyToImport")}</p></div></li>)}</ul></div>
            {!!invalid && <p className="text-sm text-destructive">{t("entriesNeedAttentionFixAndPreviewAgainOr", { value1: invalid })}</p>}
            <Button className="justify-self-start" disabled={busy || !included.length || !!invalid} onClick={() => void perform(acceptPreview)}>{t("importAndSelectEntries", { value1: included.length })}</Button>
          </div>}
        </Panel>
        <Panel title={t("teamDrafts")} description={t("selectDraftsToRunOpenANameTo")}>
          {overview && !overview.drafts.length ? <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">{t("noDraftsYetUploadAFileOrReproduce")}</div> : <>
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm">{t("selected", { value1: selected.length })}</span><div className="flex gap-1"><Button size="sm" variant="ghost" disabled={busy || !overview?.drafts.length} onClick={() => setSelected(overview!.drafts.map(draft => draft.id))}>{t("selectAll")}</Button><Button size="sm" variant="ghost" disabled={busy || !selected.length} onClick={() => setSelected([])}>{t("clearSelection")}</Button></div></div>
            {dirty && <p className="text-xs text-muted-foreground">{t("saveOrDiscardYourChangesBeforeOpeningAnother")}</p>}
            <div data-yeye-scroll="auto" className="max-h-80 overflow-y-auto"><ul className="divide-y">{overview?.drafts.map(entry => <li key={entry.id} className="flex items-center gap-3 py-3"><Check label={t("select")} checked={selected.includes(entry.id)} disabled={busy} onChange={checked => setSelected(current => checked ? [...new Set([...current, entry.id])] : current.filter(id => id !== entry.id))} /><div className="min-w-0 flex-1"><button className="w-full break-words text-left text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50" disabled={busy || dirty} onClick={() => void perform(async () => { const next = await api<QualityDraftData>(`?kind=draft&id=${entry.id}`); setDraft(next); setInput(next.input); })}>{entry.sources.map(source => source.name).join(" · ") || t("reproductionDraft")}</button><p className="mt-1 text-xs text-muted-foreground">{t("revisionExpires", { value1: entry.revision })}{dateText(entry.expiresAt, en)}</p></div>{entry.id === draft?.id && <Badge variant="secondary">{t("editing")}</Badge>}</li>)}</ul></div>
          </>}
        </Panel>
        {draft && input && <DraftEditor draft={draft} input={input} setInput={setInput} busy={busy} onSave={() => void perform(async () => { const next = await api<QualityDraftData>("", { action: "edit", id: draft.id, revision: draft.revision, input: parseReproductionPackage(input) }); setDraft(next); setInput(next.input); setSelected(current => [...new Set([...current, next.id])]); await refresh(); setNotice(t("draftSavedAndSelectedStartItFromRun")); })} />}
      </div>
      <div className="min-w-0 lg:sticky lg:top-6"><Panel title={t("step2RunTests")} description={t("savedDraftsRunInTheBackgroundEvenAfter")}>
        <div className="flex flex-wrap items-center justify-between gap-2"><Badge variant="secondary">{t("selected", { value1: selected.length })}</Badge><span className="text-xs text-muted-foreground">{!overview ? t("checkingService") : workerReady ? t("testServiceReady") : t("waitingForTestService")}</span></div>
        {overview && !workerReady && <p className="text-xs text-muted-foreground">{t("youCanQueueTestsNowTheyWillRun")}</p>}
        {overview?.worker?.syncError && <Alert variant="destructive"><AlertTitle>{t("productionSyncFailed")}</AlertTitle><AlertDescription>{t("existingVersionsRemainAvailableAnAdministratorCanRetry")}<details className="mt-2"><summary>{t("showReason")}</summary><p className="break-all">{overview.worker.syncError}</p></details></AlertDescription></Alert>}
        <div className="grid gap-2"><Label htmlFor="batch-name">{t("batchNameOptional")}</Label><Input id="batch-name" value={label} maxLength={120} disabled={busy} placeholder={t("eGTradingPostFeedbackCheck")} onChange={e => setLabel(e.target.value)} /></div>
        <Choice label={t("testVersion")} value={candidate} options={versionOptions.length ? versionOptions : [{ value: "", label: t("noVersionsAvailable") }]} onChange={setCandidate} disabled={busy || !versionOptions.length} />
        <Choice label={t("compareAgainst")} value={baseline} options={[{ value: "", label: t("noneTestSelectedVersionOnly") }, ...versionOptions]} onChange={setBaseline} disabled={busy || !versionOptions.length} />
        {overview?.versions.length === 1 && <p className="text-xs text-muted-foreground">{t("onlyOneProductionVersionIsAvailableYouCan")}</p>}
        {runReason && <p id="run-reason" className="text-sm text-muted-foreground">{runReason}</p>}
        <Button disabled={busy || !!runReason} aria-describedby={runReason ? "run-reason" : undefined} onClick={() => void perform(async () => { const next = await api<QualityBatchData>("", { action: "batch", ids: selected, bundleIds: baseline ? [baseline, candidate] : [candidate], label: label.trim() || t("feedbackReproductionTest") }); setBatch(next); setResult(null); setBatchNavigation(current => current + 1); await refresh(); setNotice(t("testsAreQueuedWhenFinishedChooseViewResult")); })}>{busy ? <Loader2 aria-hidden="true" className="motion-safe:animate-spin" /> : <Play aria-hidden="true" />}{t("runTests", { count: selected.length })}</Button>
        <p className="text-xs text-muted-foreground">{t("casesRunOneAtATimeUpTo")}</p>
        {overview?.isAdmin && <details className="border-t pt-3"><summary className="cursor-pointer text-sm text-muted-foreground">{t("manageSolverVersions")}</summary><p className="my-3 text-xs text-muted-foreground">{t("syncAPublishedProductionVersionItBecomesAvailable")}</p><Button variant="outline" disabled={busy} onClick={() => void perform(async () => { await api("", { action: "sync" }); setNotice(t("productionSyncRequestedTheVersionListWillUpdate")); })}><RefreshCw aria-hidden="true" />{t("syncProductionVersion")}</Button></details>}
      </Panel></div>
    </div>
    <div ref={historySection} tabIndex={-1} className="scroll-mt-6 rounded-lg focus-visible:outline-2 focus-visible:outline-ring"><Panel title={t("step3TestHistoryAndResults")} description={t("openABatchThenChooseViewResultOn")}>
      {overview && !overview.batches.length && <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">{t("noTestRunsYetSelectDraftsAndA")}</p>}
      <div data-yeye-scroll="auto" className="grid max-h-80 gap-2 overflow-y-auto">{overview?.batches.map(item => <button key={item.id} disabled={busy} aria-pressed={batch?.id === item.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring aria-pressed:border-primary aria-pressed:bg-muted/50 disabled:opacity-50" onClick={() => void perform(async () => { setBatch(await api(`?kind=batch&id=${item.id}`)); setResult(null); setBatchNavigation(current => current + 1); })}><span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{item.label}</span><span className="mt-1 block text-xs text-muted-foreground">{dateText(item.createdAt, en)} · {item.bundleIds.length === 2 ? t("twoVersionComparison") : t("singleVersionTest")}</span></span><Status status={item.status} /><span className="text-sm font-medium text-primary">{["queued", "running"].includes(item.status) ? t("viewProgress") : t("viewResults")}</span></button>)}</div>
    </Panel></div>
    {batch && <div ref={batchSection} tabIndex={-1} className="scroll-mt-6 rounded-lg focus-visible:outline-2 focus-visible:outline-ring"><BatchDetails batch={batch} busy={busy} onAction={action => void perform(async () => { await api("", { action, id: batch.id }); setBatch(await api(`?kind=batch&id=${batch.id}`)); await refresh(); })} onResult={(attempt, name) => void perform(async () => setResult({ data: await api(`?kind=result&id=${batch.id}&attempt=${attempt}`), name }))} /></div>}
    {result && <div ref={resultSection} tabIndex={-1} className="min-w-0 scroll-mt-6 rounded-lg focus-visible:outline-2 focus-visible:outline-ring"><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><p className="min-w-0 break-words text-sm text-muted-foreground">{batch?.label} · {result.name}</p><Button variant="outline" onClick={() => reveal(batchSection.current)}>{t("backToBatchCases")}</Button></div><ResultPanel result={result.data} name={result.name} versions={overview?.versions ?? []} /></div>}
  </main>;
}
