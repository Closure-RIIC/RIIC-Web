"use client";

import { lazy, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ManualScheduleDraft } from "@/manual-schedule";
import type { SchedulePosterDocument } from "@/schedule-poster-document";
import { POSTER_HANDOFF_KEY } from "@/schedule-poster-storage";
import { DEFAULT_MANUAL_SHIFT_START_TIME } from "@/manual-schedule-config";
import { useWorkbench } from "@/workbench-context";

function ManualScheduleLoading() {
  return <section className="grid min-h-[calc(100svh-9rem)] content-start gap-4 py-5" aria-hidden="true" data-manual-schedule-loading><Skeleton className="h-9 w-full" /><Skeleton className="h-20 w-full" /><Skeleton className="h-40 w-full" /></section>;
}
const ManualSchedulePage = lazy(() => import("@/components/pages/ManualSchedulePage").then((module) => ({ default: module.ManualSchedulePage })));

export function ManualScheduleRoute() {
  const { manual } = useWorkbench();
  const [poster, setPoster] = useState<SchedulePosterDocument | null>(null);
  const [revision, setRevision] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const restored = useRef(false);
  const [initial, setInitial] = useState<ManualScheduleDraft | null>(null);
  const callbacks = useRef(manual);
  useEffect(() => { callbacks.current = manual; }, [manual]);
  async function importPoster(document: SchedulePosterDocument) {
    const [{ posterDraftForManual }, { posterOperators }] = await Promise.all([
      import("@/schedule-poster-document"),
      import("@/schedule-poster-operators"),
    ]);
    const operators = posterOperators(document);
    setInitial(posterDraftForManual(document));
    setPoster({ ...document, operators }); setRevision(value => value + 1);
    const shared = callbacks.current;
    shared.onPosterWorkingBoxChange?.(operators);
    shared.onImportedLayoutChange(document.layout);
    shared.onShiftDurationsChange(document.draft.shifts.map(shift => shift.durationHours));
    shared.onShiftStartTimeChange(document.draft.startTime || DEFAULT_MANUAL_SHIFT_START_TIME);
    shared.onScheduleModeChange(document.draft.scheduleMode);
    shared.onFiammettaEnabledChange(document.draft.fiammettaEnabled);
  }
  useEffect(() => {
    if (restored.current || !manual.restorationReady) return;
    restored.current = true;
    async function restore() {
      try {
        const code = new URLSearchParams(window.location.search).get("code");
        const handoffKey = `${POSTER_HANDOFF_KEY}.manual`;
        const handoff = code ? null : window.sessionStorage.getItem(handoffKey);
        if (!code && !handoff) { setReady(true); return; }
        const { readPosterFile } = await import("@/schedule-poster-document");
        if (code) {
          if (!/^[a-f0-9]{12}$/.test(code)) throw new Error("作业码格式不正确。");
          const response = await fetch(`/api/schedule-posters?code=${code}`);
          const payload = await response.json(); if (!response.ok) throw new Error(payload.error);
          await importPoster(readPosterFile(JSON.stringify(payload.document)));
        } else {
          if (handoff) { await importPoster(readPosterFile(handoff)); window.sessionStorage.removeItem(handoffKey); }
        }
      } catch (e) { setError(e instanceof Error ? e.message : "读取作业失败。"); }
      finally { setReady(true); }
    }
    void restore();
  }, [manual.restorationReady]);
  if (!ready) return <ManualScheduleLoading />;
  return <>
    {error ? <p role="alert" className="mb-3 text-sm text-destructive">{error}</p> : null}
    {poster ? <div className="mb-3 flex flex-wrap items-center gap-3 border-y py-2 text-xs text-muted-foreground"><span>作业副本：{poster.meta.title} · 使用作业练度，可在排班编辑中调整；个人干员池保留。</span><Button size="sm" variant="ghost" onClick={() => { window.location.href = "/manual"; }}>返回个人草稿</Button></div> : null}
    <ManualSchedulePage key={revision} {...manual} {...(poster ? { persistDraft: false, sourceName: "作业练度（非个人干员池）", initialDraft: initial, restorationReady: true, onInitialDraftConsumed: () => setInitial(null) } : {})} initialPosterDocument={poster} onImportPoster={document => { void importPoster(document).catch(error => setError(error instanceof Error ? error.message : "读取作业失败。")); }} />
  </>;
}
