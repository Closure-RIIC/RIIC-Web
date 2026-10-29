"use client";
import { useTranslations } from "use-intl";

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Download, RotateCcw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CompactScheduleView } from "@/components/CompactScheduleView";
import { planToRows } from "@/schedule";
import type { QualityBatchData, QualityVersion } from "@riic/arknights-domain/quality";
import type { ReproductionPackage } from "@riic/arknights-domain/reproduction-package";
import type { MaaJson, RotationJson } from "@riic/arknights-domain/types";
import { Choice, dateText, download, Panel, Status, statusText, useWorkbenchText, versionText } from "./workbench-ui";

export function BatchDetails({ batch, busy, onAction, onResult }: { batch: QualityBatchData; busy: boolean; onAction: (action: "cancel" | "retry") => void; onResult: (attempt: string, name: string) => void }) {
  const { en } = useWorkbenchText();
  const t = useTranslations("QualityWorkbench");
  const finished = batch.cases.filter(item => ["completed", "failed", "cancelled"].includes(item.status)).length;
  const failed = batch.cases.filter(item => item.status === "failed").length;
  return <Panel title={batch.label} description={t("reviewEachCaseSAttemptsRetryingPreservesEarlier")}>
    <div className="flex flex-wrap items-center justify-between gap-3"><Status status={batch.status} /><span className="text-sm tabular-nums">{t("finished", { value1: finished, value2: batch.cases.length })}{failed > 0 && ` · ${t("failed", { value1: failed })}`}</span></div>
    <progress aria-label={t("batchProgress")} max={Math.max(batch.cases.length, 1)} value={finished} className="h-2 w-full overflow-hidden rounded-full accent-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary" />
    {batch.status === "queued" && <p className="text-sm text-muted-foreground">{t("waitingForTheTestServiceToRunThis")}</p>}
    <div className="flex flex-wrap gap-2">{["queued", "running"].includes(batch.status) && <Button variant="outline" disabled={busy} onClick={() => onAction("cancel")}><Square aria-hidden="true" />{t("cancelBatch")}</Button>}{batch.status === "failed" && <Button variant="outline" disabled={busy} onClick={() => onAction("retry")}><RotateCcw aria-hidden="true" />{t("retryFailedCases")}</Button>}</div>
    <div className="divide-y">{batch.cases.map((item, index) => {
      const name = item.sources.map(source => source.name).join(" · ") || t("case", { value1: index + 1 });
      return <article key={item.id} className="grid gap-3 py-4"><div className="flex flex-wrap items-start justify-between gap-2"><h3 className="min-w-0 flex-1 break-words text-sm font-medium">{index + 1}. {name}</h3><Status status={item.status} /></div>
        {item.attempts.length > 0 ? <div className="flex flex-wrap gap-2">{item.attempts.map((attempt, i) => <Button key={attempt.id} variant="outline" size="sm" disabled={busy || attempt.status === "running"} title={dateText(attempt.startedAt, en)} onClick={() => onResult(attempt.id, name)}>{t("attempt", { value1: item.attempts.length - i })}{statusText(attempt.status, en)}{attempt.status !== "running" && t("viewResult")}</Button>)}</div> : <p className="text-xs text-muted-foreground">{t("noAttemptsYet")}</p>}
        {item.sources.filter(source => source.feedbackId).map(source => <Link key={source.feedbackId} className="text-sm underline underline-offset-4" to="/admin/issues" search={{ q: encodeURIComponent(source.feedbackId!) }}>{t("recordFindingsOnFeedback")} · {source.name}</Link>)}
      </article>;
    })}</div>
  </Panel>;
}

type ResultData = {
  summary?: { error?: string }; error?: string;
  results?: { bundleId: string; ok: boolean; valid: boolean; elapsedMs: number; error?: string; summary?: { daily: { trade: number | null; manu: number | null; power: number | null } } | null; response?: { result?: { maa: MaaJson; rotation: RotationJson } } }[];
  input?: ReproductionPackage;
  comparison?: { scheduleChanged: boolean; dailyDelta: { trade: number | null; manu: number | null; power: number | null }; elapsedDeltaMs: number } | null;
};

export function ResultPanel({ result, name, versions }: { result: unknown; name: string; versions: QualityVersion[] }) {
  const [shift, setShift] = useState("0");
  const { en } = useWorkbenchText();
  const t = useTranslations("QualityWorkbench");
  const data = result as ResultData;
  const versionName = (id: string) => {
    const index = versions.findIndex(version => version.id === id);
    return index === -1 ? id.slice(0, 12) : versionText(versions[index], index, en);
  };
  const number = (value: number | null | undefined) => value == null ? "—" : new Intl.NumberFormat(en === "en" ? "en-US" : "zh-CN", { maximumFractionDigits: 2 }).format(value);
  return <Panel title={t("executionResult")} description={name}>
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{data.comparison ? t("revenueChangesAreTestMinusComparisonVersionTiming") : t("thisIsASingleVersionTestWithNo")}</p><Button variant="outline" onClick={() => download("quality-result.json", result)}><Download aria-hidden="true" />{t("downloadResult")}</Button></div>
    {!data.results?.length && <Alert variant="destructive"><AlertDescription>{data.summary?.error ?? data.error ?? t("thisAttemptProducedNoResultCheckTheInput")}</AlertDescription></Alert>}
    <div className="grid gap-4 md:grid-cols-2">{data.results?.map(item => <div key={item.bundleId} className="grid min-w-0 gap-3 rounded-lg border p-4"><h3 className="break-words text-sm font-semibold" title={item.bundleId}>{versionName(item.bundleId)}</h3><div className="flex flex-wrap gap-2"><Status status={item.ok ? "completed" : "failed"} /><Badge variant={item.valid ? "secondary" : "destructive"}>{item.valid ? t("validSchedule") : t("noValidSchedule")}</Badge></div>{item.error && <p role="alert" className="break-words text-sm text-destructive">{item.error}</p>}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">{[[t("dailyTradingRevenue"), number(item.summary?.daily.trade)], [t("dailyManufacturingRevenue"), number(item.summary?.daily.manu)], [t("dailyPowerRevenue"), number(item.summary?.daily.power)], [t("computeTime"), `${number(item.elapsedMs / 1000)} ${t("s")}`]].map(([title, value]) => <div key={title}><dt className="text-xs text-muted-foreground">{title}</dt><dd className="mt-1 font-medium tabular-nums">{value}</dd></div>)}</dl>
    </div>)}</div>
    {data.comparison && <div className="rounded-lg bg-muted/50 p-4 text-sm"><h3 className="font-semibold">{t("versionComparison")}</h3><p className="mt-2">{data.comparison.scheduleChanged ? t("scheduleChanged") : t("scheduleUnchanged")}</p><dl className="mt-3 grid gap-3 sm:grid-cols-3">{[[t("tradingDelta"), data.comparison.dailyDelta.trade], [t("manufacturingDelta"), data.comparison.dailyDelta.manu], [t("powerDelta"), data.comparison.dailyDelta.power]].map(([title, value]) => <div key={String(title)}><dt className="text-xs text-muted-foreground">{title}</dt><dd className="mt-1 font-medium tabular-nums">{typeof value === "number" && value > 0 ? "+" : ""}{number(value as number | null)}</dd></div>)}</dl></div>}
    {data.results?.map(item => {
      const payload = item.response?.result;
      if (!payload?.maa?.plans?.length || !data.input) return null;
      const active = Math.min(Number(shift), payload.maa.plans.length - 1);
      const plan = payload.maa.plans[active];
      const detailRows = planToRows(plan, payload.rotation?.shifts?.[active], data.input.layout);
      const detailProducts = new Map(detailRows.flatMap(row => row.roomProduct ? [[row.roomId, row.roomProduct] as const] : []));
      return <div key={item.bundleId} className="grid min-w-0 gap-3 border-t pt-4"><h3 className="text-sm font-semibold">{t("scheduleDetails")} · {versionName(item.bundleId)}</h3><div className="max-w-sm"><Choice label={t("viewShift")} value={String(active)} options={payload.maa.plans.map((_, i) => ({ value: String(i), label: t("shift", { value1: i + 1 }) }))} onChange={setShift} /></div><CompactScheduleView layout={data.input.layout} rows={detailRows} roomProducts={detailProducts} activeShift={active} activePlan={plan} shiftDirection={0} feedbackDisabled /></div>;
    })}
    <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">{t("fullExecutionRecordJson")}</summary><div data-yeye-scroll="auto" className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs"><pre className="m-0 whitespace-[inherit]">{JSON.stringify(result, null, 2)}</pre></div></details>
  </Panel>;
}
