"use client";


import type { AppLocale } from "@riic/contracts/locale";
import { createLocalizer as createUiLocalizer } from "@riic/arknights-domain/i18n/localize";
import type UiMessages from "../../../../messages/zh-CN/AK_app_admin_issues_issues_client.json";
const uiText = createUiLocalizer<typeof UiMessages>("AK_app_admin_issues_issues_client");

import { useAdminRequest, useAdminHref } from "../admin-context";
import { adminPageClass } from "../admin-page";
import { useTranslations, useLocale } from "use-intl";
import { messageRecord } from "@/i18n/translate";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "@/navigation";
import {
  AlertTriangle,
  Bug,
  Check,
  ChevronDown,
  ChevronUp,
  Clipboard,
  Download,
  Inbox,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { rotationDescription } from "@riic/arknights-domain/rotation-settings";
import type {
  AdminFeedbackDeleteData,
  AdminFeedbackDetailData,
  AdminFeedbackFacility,
  AdminFeedbackListData,
  AdminFeedbackRecordData,
  AdminFeedbackStatus,
  AdminPlanRunDetailData,
  AdminPlanRunListData,
  AdminPlanRunRecordData,
  AdminReproductionData,
} from "@riic/arknights-domain/types";
import { localizedOperatorName } from "@/i18n/game-data";
import { useGameCatalog } from "@/i18n/game-data-client";
import { RelatedFeedback } from "./related-feedback";

const PAGE_SIZE = 50;

const STATUSES: AdminFeedbackStatus[] = ["unreviewed", "reviewed", "ignored", "reproduced", "fixed"];

const FACILITY_FILTERS: AdminFeedbackFacility[] = ["trading", "manufacture", "power", "control", "dormitory", "meeting", "hire", "processing", "training", "solver", "unknown"];

type DetailState = {
  history?: AdminFeedbackDetailData["history"];
  solverExecutableSha256?: string | null;
  loading: boolean;
  error: string | null;
  reproduction: AdminReproductionData | null;
};


function formatDate(value: string, en: AppLocale = "zh-CN"): string {
  return new Intl.DateTimeFormat(en, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function statusClass(status: AdminFeedbackStatus): string {
  if (status === "fixed") return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/45 dark:text-emerald-300";
  if (status === "reproduced") return "bg-amber-50 text-amber-800 dark:bg-amber-950/45 dark:text-amber-300";
  return "bg-muted text-muted-foreground";
}

function downloadReproduction(reproduction: AdminReproductionData, boxOnly = false): void {
  if (!reproduction.operbox || (!boxOnly && !reproduction.available)) return;
  const payload = boxOnly ? reproduction.operbox : {
    format: "riic-reproduction",
    version: 1,
    diagnosticId: reproduction.diagnosticId,
    layout: reproduction.layout,
    operbox: reproduction.operbox,
    rotation: reproduction.rotation,
    fiammetta_enable: reproduction.fiammettaEnabled,
  };
  const href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `${boxOnly ? "box" : "solver-reproduction"}-${reproduction.diagnosticId}.json`;
  anchor.click();
  URL.revokeObjectURL(href);
}

function ReproductionPanel({ state }: { state: DetailState }) {
  const intl = useTranslations();
  const locale = useLocale();
  const gameCatalog = useGameCatalog();
  const en = locale;
  const [copied, setCopied] = useState(false);
  if (state.loading) {
    return <p role="status" className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="animate-spin" />{intl("app_admin_issues_issues_client.loadingReproductionData")}</p>;
  }
  if (state.error) return <p role="alert" className="py-4 text-sm text-destructive">{state.error}</p>;
  const reproduction = state.reproduction;
  if (!reproduction) return null;
  const operatorNames = reproduction.operbox?.map((operator) => localizedOperatorName(operator.name, locale, gameCatalog)).filter(Boolean) ?? [];
  return (
    <div className="grid gap-4 border-t border-border/70 pt-4">
      {!reproduction.available ? (
        <p role="status" className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:bg-amber-950/35 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 shrink-0" aria-hidden="true" />
          {(messageRecord(en, "app_admin_issues_issues_client_labels"))[reproduction.unavailableReason ?? "incomplete"]}
        </p>
      ) : null}

      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-xs text-muted-foreground">{intl("app_admin_issues_issues_client.baseLayout")}</dt><dd className="mt-1 font-medium">{reproduction.layout?.template ?? (intl("app_admin_issues_issues_client.unavailable"))}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Operator Box</dt><dd className="font-number mt-1 font-medium">{reproduction.operbox ? (intl("app_admin_issues_issues_client.operators", { length: reproduction.operbox.length })) : (intl("app_admin_issues_issues_client.unavailable"))}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{intl("app_admin_issues_issues_client.rotationCount")}</dt><dd className="font-number mt-1 font-medium">{reproduction.rotationCount ?? (intl("app_admin_issues_issues_client.unavailable"))}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Fiammetta</dt><dd className="mt-1 font-medium">{reproduction.fiammettaEnabled === null ? (intl("app_admin_issues_issues_client.unavailable")) : reproduction.fiammettaEnabled ? (intl("app_admin_issues_issues_client.enabled")) : (intl("app_admin_issues_issues_client.disabled"))}</dd></div>
      </dl>
      {reproduction.rotation ? <p className="text-xs text-muted-foreground">{intl("app_admin_issues_issues_client.rotation")}{rotationDescription(reproduction.rotation, en)}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={!reproduction.operbox} onClick={() => downloadReproduction(reproduction, true)}>
          <Download aria-hidden="true" />{uiText.text(en, "exportBox")}
        </Button>
        <Button type="button" variant="outline" disabled={!reproduction.available} onClick={() => downloadReproduction(reproduction)}>
          <Download aria-hidden="true" />{intl("app_admin_issues_issues_client.downloadReproductionJson")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={async () => {
            await navigator.clipboard.writeText(reproduction.diagnosticId);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? <Check aria-hidden="true" /> : <Clipboard aria-hidden="true" />}
          {copied ? (intl("app_admin_issues_issues_client.copied")) : (intl("app_admin_issues_issues_client.copyDiagnosticId"))}
        </Button>
      </div>

      {state.solverExecutableSha256 ? <p className="break-all text-xs text-muted-foreground">SHA256: {state.solverExecutableSha256}</p> : null}
      {state.history?.length ? <ol className="grid gap-2 text-sm" aria-label={uiText.text(en, "reviewHistory")}>
        {state.history.map((event) => <li key={event.id} className="rounded-lg bg-muted p-3">
          <p>{formatDate(event.createdAt, en)} · {event.actorUserId ?? "—"} · {messageRecord(en, "app_admin_issues_issues_client_labels2")[event.status]}</p>
          <p className="whitespace-pre-wrap">{event.note}</p>
        </li>)}
      </ol> : null}

      {operatorNames.length ? (
        <details className="rounded-lg bg-muted/55 px-3 py-2.5 text-sm">
          <summary className="min-h-10 cursor-pointer py-2 font-medium">{intl("app_admin_issues_issues_client.viewBoxOperatorList")}</summary>
          <p className="break-words pb-2 leading-6 text-muted-foreground">{operatorNames.join(intl("app_admin_issues_issues_client.label"))}</p>
        </details>
      ) : null}
      {reproduction.error ? (
        <div>
          <h4 className="text-sm font-medium">{intl("app_admin_issues_issues_client.solverError")}</h4>
          <div data-yeye-scroll="auto" className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-neutral-950 p-3 text-xs leading-5 text-neutral-100"><pre className="m-0 whitespace-[inherit]">{reproduction.error}</pre></div>
        </div>
      ) : null}
      {reproduction.stderrExcerpt ? (
        <details className="rounded-lg bg-muted/55 px-3 py-2.5 text-sm">
          <summary className="min-h-10 cursor-pointer py-2 font-medium">{intl("app_admin_issues_issues_client.viewStderrTail")}</summary>
          <div data-yeye-scroll="auto" className="max-h-72 overflow-auto whitespace-pre-wrap pb-2 text-xs leading-5 text-muted-foreground"><pre className="m-0 whitespace-[inherit]">{reproduction.stderrExcerpt}</pre></div>
        </details>
      ) : null}
      {reproduction.stdoutExcerpt ? (
        <details className="rounded-lg bg-muted/55 px-3 py-2.5 text-sm">
          <summary className="min-h-10 cursor-pointer py-2 font-medium">{intl("app_admin_issues_issues_client.viewStdoutTail")}</summary>
          <div data-yeye-scroll="auto" className="max-h-72 overflow-auto whitespace-pre-wrap pb-2 text-xs leading-5 text-muted-foreground"><pre className="m-0 whitespace-[inherit]">{reproduction.stdoutExcerpt}</pre></div>
        </details>
      ) : null}
    </div>
  );
}

function FeedbackRow({
  item,
  selected,
  busy,
  detail,
  expanded,
  onSelect,
  onStatus,
  onToggleDetail,
}: {
  item: AdminFeedbackRecordData;
  selected: boolean;
  busy: boolean;
  detail?: DetailState;
  expanded: boolean;
  onSelect: (selected: boolean) => void;
  onStatus: (status: AdminFeedbackStatus) => void;
  onToggleDetail: () => void;
}) {
  const intl = useTranslations();
  const locale = useLocale();
  const gameCatalog = useGameCatalog();
  const en = locale;
  const statusLabels = messageRecord(en, "app_admin_issues_issues_client_labels2");
  const facilityLabels = messageRecord(en, "app_admin_issues_issues_client_labels3");
  return (
    <article className="rounded-xl bg-background p-4 shadow-[var(--shadow-border)] sm:p-5">
      <div className="flex items-start gap-3">
        <label className="grid min-h-11 min-w-11 shrink-0 cursor-pointer place-items-center" aria-label={intl("app_admin_issues_issues_client.selectFeedback", { id: item.id })}>
          <input type="checkbox" checked={selected} onChange={(event) => onSelect(event.target.checked)} className="size-4 accent-foreground" />
        </label>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{item.room?.title ?? facilityLabels[item.facility]}</h3>
            <Badge className={statusClass(item.status)}>{statusLabels[item.status]}</Badge>
            <span className="font-number text-xs text-muted-foreground">{formatDate(item.createdAt, en)}</span>
          </div>
          <p className="mt-2 break-words whitespace-pre-wrap text-sm leading-6">{item.note}</p>
          {item.room?.operators.length ? <p className="mt-2 break-words text-xs leading-5 text-muted-foreground">{intl("app_admin_issues_issues_client.currentOperators")}{item.room.operators.map((name) => localizedOperatorName(name, locale, gameCatalog)).join(intl("app_admin_issues_issues_client.label"))}</p> : null}
          <p className="font-number mt-2 break-all text-[11px] text-muted-foreground">{item.diagnosticId}</p>
          <p className="font-number mt-1 break-all text-[11px] text-muted-foreground">{item.id}</p>
          {item.adminNote ? <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{item.adminNote}</p> : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3">
        <div role="group" className="flex flex-wrap gap-1" aria-label={intl("app_admin_issues_issues_client.reviewStatus")}>
          {STATUSES.map((status) => (
            <Button
              key={status}
              type="button"
              size="sm"
              variant={item.status === status ? "secondary" : "ghost"}
              aria-pressed={item.status === status}
              disabled={busy}
              onClick={() => onStatus(status)}
            >
              {statusLabels[status]}
            </Button>
          ))}
        </div>
        <Button type="button" size="sm" variant="outline" aria-expanded={expanded} onClick={onToggleDetail}>
          {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
          {expanded ? (intl("app_admin_issues_issues_client.hideReproduction")) : (intl("app_admin_issues_issues_client.viewReproduction"))}
        </Button>
      </div>
      {expanded && detail ? <div className="mt-4"><ReproductionPanel state={detail} /></div> : null}
    </article>
  );
}

function RunRow({
  item,
  detail,
  expanded,
  onToggleDetail,
}: {
  item: AdminPlanRunRecordData;
  detail?: DetailState;
  expanded: boolean;
  onToggleDetail: () => void;
}) {
  const intl = useTranslations();
  const locale = useLocale();
  const en = locale;
  return (
    <article className="rounded-xl bg-background p-4 shadow-[var(--shadow-border)] sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="destructive">{item.errorCode ?? (intl("app_admin_issues_issues_client.unclassifiedError"))}</Badge>
            <span className="font-number text-xs text-muted-foreground">{formatDate(item.createdAt, en)}</span>
          </div>
          <p className="font-number mt-2 break-all text-xs">{item.diagnosticId}</p>
        </div>
        <Button type="button" size="sm" variant="outline" aria-expanded={expanded} onClick={onToggleDetail}>
          {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
          {expanded ? (intl("app_admin_issues_issues_client.collapse")) : (intl("app_admin_issues_issues_client.reproductionAndError"))}
        </Button>
      </div>
      <dl className="mt-4 grid gap-x-6 gap-y-3 border-t border-border/70 pt-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
        <div><dt className="text-xs text-muted-foreground">{intl("app_admin_issues_issues_client.layout")}</dt><dd className="mt-1 font-medium">{item.layoutTemplate}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{intl("app_admin_issues_issues_client.operators2")}</dt><dd className="font-number mt-1 font-medium">{item.operatorCount}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{intl("app_admin_issues_issues_client.rotation2")}</dt><dd className="mt-1 font-medium">{item.rotation}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Fiammetta</dt><dd className="mt-1 font-medium">{item.fiammettaEnable ? (intl("app_admin_issues_issues_client.enabled")) : (intl("app_admin_issues_issues_client.disabled"))}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{intl("app_admin_issues_issues_client.solverDuration")}</dt><dd className="font-number mt-1 font-medium">{item.durationMs === null ? "—" : `${item.durationMs} ms`}</dd></div>
      </dl>
      {expanded && detail ? <div className="mt-4"><ReproductionPanel state={detail} /></div> : null}
    </article>
  );
}

export function AdminIssues({ isAdmin = false }: { isAdmin?: boolean }) {
  const requestData = useAdminRequest();
  const adminHref = useAdminHref();
  const intl = useTranslations();
  const locale = useLocale();
  const en = locale;
  // Language changes update copy without reloading or overwriting in-progress work.
  const languageEffectRef = useRef({ intl, en });
  useEffect(() => { languageEffectRef.current = { intl, en }; }, [intl, en]);
  const statusLabels = messageRecord(en, "app_admin_issues_issues_client_labels4");
  const facilityLabels = messageRecord(en, "app_admin_issues_issues_client_labels5");
  const [feedback, setFeedback] = useState<AdminFeedbackListData>({ items: [], total: 0, limit: PAGE_SIZE, offset: 0 });
  const [runs, setRuns] = useState<AdminPlanRunListData>({ items: [], total: 0, limit: PAGE_SIZE, offset: 0 });
  const router = useRouter();
  const searchParams = useSearchParams();
  const feedbackOffset = Math.max(0, Number(searchParams.get("offset")) || 0);
  const [runOffset, setRunOffset] = useState(0);
  const statusFilter = (searchParams.get("status") || "all") as AdminFeedbackStatus | "all";
  const facilityFilter = (searchParams.get("facility") || "all") as AdminFeedbackFacility | "all";
  const search = searchParams.get("q") ?? "";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const errorCode = searchParams.get("errorCode") ?? "";
  const solver = searchParams.get("solver") ?? "";
  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value && value !== "all") next.set(key, value); else next.delete(key);
    if (key !== "offset") next.delete("offset");
    router.replace(adminHref(`/admin/issues?${next}`), { scroll: false });
  }
  const setFeedbackOffset = (value: number) => setFilter("offset", String(value));
  const setStatusFilter = (value: string) => setFilter("status", value);
  const setFacilityFilter = (value: string) => setFilter("facility", value);
  const [review, setReview] = useState<{ items: AdminFeedbackRecordData[]; status: AdminFeedbackStatus } | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Record<string, DetailState>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyStatusId, setBusyStatusId] = useState<string | null>(null);
  const [loadingFeedback, setLoadingFeedback] = useState(true);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const feedbackRequestRef = useRef<AbortController | null>(null);
  const runRequestRef = useRef<AbortController | null>(null);

  const loadFeedback = useCallback(async () => {
    feedbackRequestRef.current?.abort();
    const controller = new AbortController();
    feedbackRequestRef.current = controller;
    setLoadingFeedback(true);
    setError(null);
    setSelected(new Set());
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(feedbackOffset) });
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (facilityFilter !== "all") params.set("facility", facilityFilter);
      if (search.trim()) params.set("q", search.trim());
      if (from) params.set("from", new Date(from).toISOString());
      if (to) params.set("to", new Date(to).toISOString());
      if (errorCode) params.set("errorCode", errorCode);
      if (solver) params.set("solver", solver);
      setFeedback(await requestData<AdminFeedbackListData>(`/api/admin/feedback?${params}`, { signal: controller.signal }, languageEffectRef.current.en));
    } catch (loadError) {
      if (controller.signal.aborted) return;
      setError(loadError instanceof Error ? loadError.message : (languageEffectRef.current.intl("app_admin_issues_issues_client.couldNotLoadFeedbackRecords")));
    } finally {
      if (feedbackRequestRef.current === controller) setLoadingFeedback(false);
    }
  }, [facilityFilter, feedbackOffset, statusFilter, search, from, to, errorCode, solver, requestData]);

  const loadRuns = useCallback(async () => {
    runRequestRef.current?.abort();
    const controller = new AbortController();
    runRequestRef.current = controller;
    setLoadingRuns(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status: "failed", limit: String(PAGE_SIZE), offset: String(runOffset) });
      setRuns(await requestData<AdminPlanRunListData>(`/api/admin/plan-runs?${params}`, { signal: controller.signal }, languageEffectRef.current.en));
    } catch (loadError) {
      if (controller.signal.aborted) return;
      setError(loadError instanceof Error ? loadError.message : (languageEffectRef.current.intl("app_admin_issues_issues_client.couldNotLoadSolverErrors")));
    } finally {
      if (runRequestRef.current === controller) setLoadingRuns(false);
    }
  }, [runOffset, requestData]);

  useEffect(() => {
    void loadFeedback();
    return () => feedbackRequestRef.current?.abort();
  }, [loadFeedback]);
  useEffect(() => {
    void loadRuns();
    return () => runRequestRef.current?.abort();
  }, [loadRuns]);

  const visibleFeedback = feedback.items;

  const groupedFeedback = useMemo(() => {
    const groups = new Map<AdminFeedbackFacility, AdminFeedbackRecordData[]>();
    for (const item of visibleFeedback) groups.set(item.facility, [...(groups.get(item.facility) ?? []), item]);
    return [...groups.entries()];
  }, [visibleFeedback]);

  const statusCounts = useMemo(() => feedback.items.reduce<Record<AdminFeedbackStatus, number>>((counts, item) => {
    counts[item.status] += 1;
    return counts;
  }, { unreviewed: 0, reviewed: 0, ignored: 0, reproduced: 0, fixed: 0 }), [feedback.items]);

  async function toggleDetail(key: string, url: string) {
    if (expanded === key) {
      setExpanded(null);
      return;
    }
    setExpanded(key);
    setDetails((current) => ({ ...current, [key]: { loading: true, error: null, reproduction: null } }));
    try {
      const data = key.startsWith("feedback:")
        ? await requestData<AdminFeedbackDetailData>(url, undefined, en)
        : await requestData<AdminPlanRunDetailData>(url, undefined, en);
      setDetails((current) => ({ ...current, [key]: { loading: false, error: null, reproduction: data.reproduction, ...("history" in data ? { history: data.history, solverExecutableSha256: data.solverExecutableSha256 } : {}) } }));
    } catch (detailError) {
      setDetails((current) => ({ ...current, [key]: { loading: false, error: detailError instanceof Error ? detailError.message : (intl("app_admin_issues_issues_client.couldNotLoadReproductionData")), reproduction: null } }));
    }
  }

  function updateStatus(item: AdminFeedbackRecordData, status: AdminFeedbackStatus) {
    setReview({ items: [item], status });
    setReviewNote(item.adminNote ?? "");
  }

  async function saveReview() {
    if (!review) return;
    setBusyStatusId(review.items[0].id);
    setMessage(null);
    setError(null);
    try {
      await requestData("/api/admin/feedback", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: review.status, note: reviewNote, items: review.items.map((item) => ({ id: item.id, expectedUpdatedAt: item.updatedAt })) }),
      }, en);
      setMessage(intl("app_admin_issues_issues_client.feedbackMarked", { value1: statusLabels[review.status] }));
      setReview(null);
      setDetails({});
      setExpanded(null);
      await loadFeedback();
    } catch (updateError) {
      setReview(null);
      await loadFeedback();
      setError(updateError instanceof Error ? updateError.message : (intl("app_admin_issues_issues_client.couldNotUpdateFeedbackStatus")));
    } finally {
      setBusyStatusId(null);
    }
  }

  async function reproduce(ids: string[]) {
    setBusyStatusId(ids[0]); setError(null);
    try {
      const created = await requestData<{ id: string }[]>("/api/admin/quality", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "feedback", ids }) }, en);
      const drafts = created.map((draft) => draft.id);
      router.push(adminHref(`/admin/quality?${drafts.length === 1 ? `draft=${drafts[0]}` : `drafts=${drafts.join(",")}`}`));
    } catch (error) { setError(error instanceof Error ? error.message : "Reproduction failed"); }
    finally { setBusyStatusId(null); }
  }

  async function deleteSelected() {
    const ids = [...selected];
    if (!ids.length) return;
    setDeleting(true);
    setMessage(null);
    setError(null);
    try {
      const result = await requestData<AdminFeedbackDeleteData>("/api/admin/feedback", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      }, en);
      setConfirmDelete(false);
      setSelected(new Set());
      setDetails((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !result.deletedIds.some((id) => key === `feedback:${id}`))));
      setExpanded((current) => current && result.deletedIds.some((id) => current === `feedback:${id}`) ? null : current);
      setMessage(intl("app_admin_issues_issues_client.deletedFeedbackRecords", { deletedCount: result.deletedCount }));
      await loadFeedback();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : (intl("app_admin_issues_issues_client.couldNotDeleteFeedback")));
    } finally {
      setDeleting(false);
    }
  }

  const allVisibleSelected = visibleFeedback.length > 0 && visibleFeedback.every((item) => selected.has(item.id));

  return (
    <main id="admin-content" className={adminPageClass}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.012em]">{intl("app_admin_issues_issues_client.solverIssues")}</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{intl("app_admin_issues_issues_client.reviewUserFeedbackByFacilityTrackFailedSolvesAnd")}</p>
        </div>
        <Button type="button" variant="outline" disabled={loadingFeedback || loadingRuns} onClick={() => { setDetails({}); setExpanded(null); void loadFeedback(); void loadRuns(); }}>
          <RefreshCw className={loadingFeedback || loadingRuns ? "animate-spin" : ""} aria-hidden="true" />{intl("app_admin_issues_issues_client.refresh")}
        </Button>
      </header>

      <div role="group" className="grid overflow-hidden rounded-xl bg-background shadow-[var(--shadow-border)] sm:grid-cols-4" aria-label={intl("app_admin_issues_issues_client.issuesOnTheCurrentPage")}>
        <div className="p-4 sm:border-r sm:border-border/70"><p className="text-xs text-muted-foreground">{statusLabels.unreviewed}</p><p className="font-number mt-1 text-2xl font-semibold">{statusCounts.unreviewed}</p></div>
        <div className="border-t border-border/70 p-4 sm:border-r sm:border-t-0"><p className="text-xs text-muted-foreground">{statusLabels.reproduced}</p><p className="font-number mt-1 text-2xl font-semibold">{statusCounts.reproduced}</p></div>
        <div className="border-t border-border/70 p-4 sm:border-r sm:border-t-0"><p className="text-xs text-muted-foreground">{statusLabels.fixed}</p><p className="font-number mt-1 text-2xl font-semibold">{statusCounts.fixed}</p></div>
        <div className="border-t border-border/70 p-4 sm:border-t-0"><p className="text-xs text-muted-foreground">{intl("app_admin_issues_issues_client.solverErrors")}</p><p className="font-number mt-1 text-2xl font-semibold">{runs.total}</p></div>
      </div>

      {message ? <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/35 dark:text-emerald-200">{message}</p> : null}
      {error ? <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}

      <Tabs defaultValue="feedback" className="gap-5">
        <TabsList variant="line" className="w-full justify-start border-b border-border/70">
          <TabsTrigger value="feedback" className="flex-none px-3 pb-2">{intl("app_admin_issues_issues_client.facilityFeedback")} <span className="font-number">{feedback.total}</span></TabsTrigger>
          <TabsTrigger value="errors" className="flex-none px-3 pb-2">{intl("app_admin_issues_issues_client.solverErrors")} <span className="font-number">{runs.total}</span></TabsTrigger>
        </TabsList>

        <TabsContent value="feedback" className="grid gap-5">
          <section aria-labelledby="feedback-filters" className="grid gap-3">
            <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); setFilter("q", String(new FormData(event.currentTarget).get("q") ?? "")); }}>
              <label className="grid flex-1 gap-2 text-sm">{uiText.text(en, "searchFeedback")}
                <input key={search} name="q" type="search" maxLength={200} defaultValue={search} placeholder={uiText.text(en, "idDescriptionReviewNoteOperator")} className="min-h-11 min-w-0 rounded-lg border border-border bg-background px-3" />
              </label>
              <Button type="submit" variant="outline">{uiText.text(en, "search")}</Button>
            </form>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {([ ["from", uiText.text(en, "from"), from, "datetime-local"], ["to", uiText.text(en, "until"), to, "datetime-local"], ["errorCode", uiText.text(en, "errorCode"), errorCode, "text"], ["solver", uiText.text(en, "solverSha256"), solver, "text"] ] as const).map(([key, label, value, type]) => <label key={key} className="grid gap-2 text-sm">{label}<input type={type} value={value} maxLength={100} className="min-h-11 min-w-0 rounded-lg border bg-background px-3" onChange={(event) => setFilter(key, event.target.value)} /></label>)}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="feedback-filters" className="font-semibold">{intl("app_admin_issues_issues_client.facilityFeedbackQueue")}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{intl("app_admin_issues_issues_client.statusAndFacilityCountsApplyToTheCurrentPage")}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={!selected.size || !!busyStatusId} onClick={() => void reproduce([...selected])}>{uiText.text(en, "addToTestBatch")}</Button>
                <Button type="button" variant="outline" disabled={!selected.size || !!busyStatusId} onClick={() => { setReview({ items: visibleFeedback.filter((item) => selected.has(item.id)), status: "reviewed" }); setReviewNote(""); }}>{uiText.text(en, "reviewSelected")} ({selected.size})</Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!visibleFeedback.length}
                  onClick={() => setSelected(allVisibleSelected ? new Set() : new Set(visibleFeedback.map((item) => item.id)))}
                >
                  {allVisibleSelected ? (intl("app_admin_issues_issues_client.clearSelection")) : (intl("app_admin_issues_issues_client.selectCurrentFacility"))}
                </Button>
                {isAdmin && <Button type="button" variant="destructive" disabled={!selected.size} onClick={() => setConfirmDelete(true)}>
                  <Trash2 aria-hidden="true" />{intl("app_admin_issues_issues_client.deleteSelected")} {selected.size ? `(${selected.size})` : ""}
                </Button>}
              </div>
            </div>

            <div role="group" className="flex flex-wrap gap-1" aria-label={intl("app_admin_issues_issues_client.filterByReviewStatus")}>
              <Button type="button" size="sm" variant={statusFilter === "all" ? "secondary" : "ghost"} aria-pressed={statusFilter === "all"} onClick={() => setStatusFilter("all")}>{intl("app_admin_issues_issues_client.all")}</Button>
              {STATUSES.map((status) => (
                <Button key={status} type="button" size="sm" variant={statusFilter === status ? "secondary" : "ghost"} aria-pressed={statusFilter === status} onClick={() => setStatusFilter(status)}>
                  {statusLabels[status]}
                </Button>
              ))}
            </div>

            <div data-yeye-scroll="auto" role="group" className="flex gap-1 overflow-x-auto pb-1" aria-label={intl("app_admin_issues_issues_client.filterByFacility")}>
              <Button type="button" size="sm" variant={facilityFilter === "all" ? "secondary" : "ghost"} className="shrink-0" aria-pressed={facilityFilter === "all"} onClick={() => setFacilityFilter("all")}>{intl("app_admin_issues_issues_client.allFacilities")}</Button>
              {FACILITY_FILTERS.map((facility) => (
                <Button key={facility} type="button" size="sm" variant={facilityFilter === facility ? "secondary" : "ghost"} className="shrink-0" aria-pressed={facilityFilter === facility} onClick={() => setFacilityFilter(facility)}>
                  {facilityLabels[facility]}
                </Button>
              ))}
            </div>
          </section>

          {loadingFeedback ? <p role="status" className="flex items-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="animate-spin" />{intl("app_admin_issues_issues_client.loadingFeedback")}</p> : null}
          {!loadingFeedback && !groupedFeedback.length ? (
            <div className="grid min-h-52 place-items-center rounded-xl bg-background p-6 text-center shadow-[var(--shadow-border)]">
              <div><Inbox className="mx-auto size-8 text-muted-foreground" aria-hidden="true" /><p className="mt-3 font-medium">{intl("app_admin_issues_issues_client.noMatchingFeedback")}</p><p className="mt-1 text-sm text-muted-foreground">{intl("app_admin_issues_issues_client.tryAnotherStatusOrFacilityFilter")}</p></div>
            </div>
          ) : null}
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"><div className="grid gap-4">
          {groupedFeedback.map(([facility, items]) => (
            <section key={facility} aria-labelledby={`facility-${facility}`} className="grid gap-3">
              <div className="flex items-center gap-2">
                <h2 id={`facility-${facility}`} className="text-sm font-semibold">{facilityLabels[facility]}</h2>
                <span className="font-number text-xs text-muted-foreground">{items.length}</span>
              </div>
              {items.map((item) => {
                const key = `feedback:${item.id}`;
                return (
                  <FeedbackRow
                    key={item.id}
                    item={item}
                    selected={selected.has(item.id)}
                    busy={busyStatusId === item.id}
                    detail={undefined}
                    expanded={expanded === key}
                    onSelect={(checked) => setSelected((current) => {
                      const next = new Set(current);
                      if (checked) next.add(item.id); else next.delete(item.id);
                      return next;
                    })}
                    onStatus={(status) => void updateStatus(item, status)}
                    onToggleDetail={() => void toggleDetail(key, `/api/admin/feedback/${encodeURIComponent(item.id)}`)}
                  />
                );
              })}
            </section>
          ))}
          </div><aside className="grid gap-4 rounded-xl border bg-background p-4 lg:sticky lg:top-20" aria-label={uiText.text(en, "feedbackDetail")}>
            {expanded?.startsWith("feedback:") && details[expanded] ? <>
              <div className="flex flex-wrap gap-2">{([-1, 1] as const).map((direction) => {
                const index = visibleFeedback.findIndex((item) => `feedback:${item.id}` === expanded);
                const adjacent = visibleFeedback[index + direction];
                return <Button key={direction} variant="outline" disabled={!adjacent} onClick={() => adjacent && void toggleDetail(`feedback:${adjacent.id}`, `/api/admin/feedback/${encodeURIComponent(adjacent.id)}`)}>{direction < 0 ? (uiText.text(en, "previousIssue")) : (uiText.text(en, "nextIssue"))}</Button>;
              })}</div>
              <h2 className="break-all font-medium">{expanded.slice(9)}</h2>
              <p className="whitespace-pre-wrap text-sm">{visibleFeedback.find((item) => `feedback:${item.id}` === expanded)?.note}</p>
              <Button disabled={!details[expanded].reproduction?.available || !!busyStatusId} onClick={() => void reproduce([expanded.slice(9)])}>{uiText.text(en, "reproduce")}</Button>
              <ReproductionPanel state={details[expanded]} />
              {visibleFeedback.find((item) => `feedback:${item.id}` === expanded) && <RelatedFeedback key={expanded} item={visibleFeedback.find((item) => `feedback:${item.id}` === expanded)!} onChanged={() => { setExpanded(null); void loadFeedback(); }} />}
            </> : <p className="text-sm text-muted-foreground">{uiText.text(en, "selectFeedbackToInspectItsReproductionAndReview")}</p>}
          </aside></div>
          <div className="flex items-center justify-between gap-3 border-t border-border/70 pt-4">
            <p className="font-number text-xs text-muted-foreground">{feedback.total ? `${feedback.offset + 1}–${Math.min(feedback.offset + feedback.items.length, feedback.total)} / ${feedback.total}` : (intl("app_admin_issues_issues_client.0Records"))}</p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={feedbackOffset === 0 || loadingFeedback} onClick={() => setFeedbackOffset(Math.max(0, feedbackOffset - PAGE_SIZE))}>{intl("app_admin_issues_issues_client.previous")}</Button>
              <Button type="button" variant="outline" disabled={feedbackOffset + feedback.items.length >= feedback.total || loadingFeedback} onClick={() => setFeedbackOffset(feedbackOffset + PAGE_SIZE)}>{intl("app_admin_issues_issues_client.next")}</Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="errors" className="grid gap-4">
          <div>
            <h2 className="font-semibold">{intl("app_admin_issues_issues_client.solverErrorRecords")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{intl("app_admin_issues_issues_client.onlyFailedSolvesAreListedCliOutputIsShown")}</p>
          </div>
          {loadingRuns ? <p role="status" className="flex items-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="animate-spin" />{intl("app_admin_issues_issues_client.loadingSolverErrors")}</p> : null}
          {!loadingRuns && !runs.items.length ? (
            <div className="grid min-h-52 place-items-center rounded-xl bg-background p-6 text-center shadow-[var(--shadow-border)]">
              <div><Bug className="mx-auto size-8 text-muted-foreground" aria-hidden="true" /><p className="mt-3 font-medium">{intl("app_admin_issues_issues_client.noSolverErrors")}</p></div>
            </div>
          ) : null}
          {runs.items.map((item) => {
            const key = `run:${item.diagnosticId}`;
            return (
              <RunRow
                key={item.diagnosticId}
                item={item}
                detail={details[key]}
                expanded={expanded === key}
                onToggleDetail={() => void toggleDetail(key, `/api/admin/plan-runs/${encodeURIComponent(item.diagnosticId)}`)}
              />
            );
          })}
          <div className="flex items-center justify-between gap-3 border-t border-border/70 pt-4">
            <p className="font-number text-xs text-muted-foreground">{runs.total ? `${runs.offset + 1}–${Math.min(runs.offset + runs.items.length, runs.total)} / ${runs.total}` : (intl("app_admin_issues_issues_client.0Records"))}</p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={runOffset === 0 || loadingRuns} onClick={() => setRunOffset(Math.max(0, runOffset - PAGE_SIZE))}>{intl("app_admin_issues_issues_client.previous")}</Button>
              <Button type="button" variant="outline" disabled={runOffset + runs.items.length >= runs.total || loadingRuns} onClick={() => setRunOffset(runOffset + PAGE_SIZE)}>{intl("app_admin_issues_issues_client.next")}</Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={!!review} onOpenChange={(open) => { if (!open && !busyStatusId) setReview(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{uiText.text(en, "recordReview")}</DialogTitle><DialogDescription>{uiText.text(en, "openingFeedbackDoesNotChangeItsStatusIgnoring")}</DialogDescription></DialogHeader>
          <DialogBody className="grid gap-4">
            <label className="grid gap-2 text-sm">{uiText.text(en, "status")}<select className="min-h-11 rounded-lg border bg-background px-3" value={review?.status ?? "reviewed"} disabled={!!busyStatusId} onChange={(event) => setReview((current) => current && ({ ...current, status: event.target.value as AdminFeedbackStatus }))}>
              {STATUSES.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}
            </select></label>
            {review?.status === "ignored" ? <div className="flex flex-wrap gap-2">{([uiText.text(en, "notReproduced"), uiText.text(en, "configurationIssue"), uiText.text(en, "expectedBehavior"), uiText.text(en, "other")]).map((note) => <Button key={note} variant="outline" size="sm" disabled={!!busyStatusId} onClick={() => setReviewNote(note)}>{note}</Button>)}</div> : null}
            <label className="grid gap-2 text-sm">{uiText.text(en, "reviewNote")}<textarea maxLength={2000} rows={4} className="rounded-lg border bg-background p-3" value={reviewNote} disabled={!!busyStatusId} onChange={(event) => setReviewNote(event.target.value)} /></label>
          </DialogBody>
          <DialogFooter><Button variant="ghost" disabled={!!busyStatusId} onClick={() => setReview(null)}>{uiText.text(en, "cancel")}</Button><Button disabled={!!busyStatusId || (review?.status === "ignored" && !reviewNote.trim())} onClick={() => void saveReview()}>{uiText.text(en, "saveReview")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmDelete} onOpenChange={(open) => { if (!deleting) setConfirmDelete(open); }}>
        <DialogContent role="alertdialog" showCloseButton={!deleting}>
          <DialogHeader>
            <DialogTitle>{intl("app_admin_issues_issues_client.deleteSelectedFeedbackRecords", { size: selected.size })}</DialogTitle>
            <DialogDescription>{intl("app_admin_issues_issues_client.feedbackSummariesReviewRecordsAndAssociatedAttachmentsWillBe")}</DialogDescription>
          </DialogHeader>
          <DialogBody><p className="text-sm text-muted-foreground">{intl("app_admin_issues_issues_client.thisCannotBeRestoredFromTheAdministrationInterface")}</p></DialogBody>
          <DialogFooter className="flex-col sm:flex-row">
            <Button type="button" size="dialog" variant="ghost" className="w-full sm:w-auto" disabled={deleting} onClick={() => setConfirmDelete(false)}>{intl("app_admin_issues_issues_client.cancel")}</Button>
            <Button type="button" size="dialog" variant="destructive" className="w-full sm:w-auto" disabled={deleting || !selected.size} onClick={() => void deleteSelected()}>
              {deleting ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
              {deleting ? (intl("app_admin_issues_issues_client.deleting")) : (intl("app_admin_issues_issues_client.confirmDeletion"))}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
