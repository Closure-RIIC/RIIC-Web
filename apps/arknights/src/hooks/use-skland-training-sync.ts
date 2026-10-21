"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { computePlan, submitPlanTask, syncSklandTraining, toDisplayError } from "@/api";
import { usePlanTask } from "./use-plan-task";
import { effectiveFiammettaSetting } from "@/plan-presentation";
import { refreshSklandTraining, trainingInputKey, trainingSyncDue, type TrainingData, type TrainingInput } from "@/skland-training-sync";
import type { SklandSessionData } from "@/types";

export type SklandTrainingSyncOptions = TrainingInput & {
  enabled: boolean;
  active: boolean;
  blocked: boolean;
  accountId: string;
  uid: string;
  resultId: string | null;
  taskQueueEnabled: boolean;
  failureMessage: string;
  onSynced: (session: SklandSessionData) => void;
};

export function useSklandTrainingSync(options: SklandTrainingSyncOptions) {
  const { enabled, active, blocked, identity, resultId } = options;
  const key = trainingInputKey(options);
  const context = JSON.stringify([enabled, identity, key, resultId]);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const attempts = useRef({ identity, last: null as number | null, retryAt: 0 });
  const [busy, setBusy] = useState(false);
  const [retryIn, setRetryIn] = useState(0);
  const [manualRequest, setManualRequest] = useState(0);
  const handledManualRequest = useRef(0);
  const [state, setState] = useState<{
    identity: string;
    resultId: string | null;
    key: string;
    data: TrainingData | null;
    syncedAt: number | null;
    error: string | null;
  } | null>(null);
  const task = usePlanTask({ storageKey: null, rejectOnAuthPause: true, onDone: () => undefined, onFailed: () => undefined });
  const detachTask = task.detach;

  // Invalidate responses after account/source/settings changes, including an A -> B -> A switch.
  useEffect(() => {
    generation.current += 1;
    return () => {
      generation.current += 1;
      detachTask();
      if (inFlight.current) {
        inFlight.current = false;
        attempts.current.last = null;
        setBusy(false);
      }
    };
  }, [context, blocked, detachTask]);

  const refresh = useEffectEvent(async (manual: boolean) => {
    if (!enabled || !active || blocked || inFlight.current || document.visibilityState !== "visible" || !navigator.onLine) return;
    if (attempts.current.identity !== identity) attempts.current = { identity, last: null, retryAt: 0 };
    const now = Date.now();
    if (!trainingSyncDue(now, attempts.current.last, attempts.current.retryAt, manual)) return;
    attempts.current.last = now;
    setRetryIn(30);
    inFlight.current = true;
    const requestGeneration = generation.current;
    const isCurrent = () => requestGeneration === generation.current;
    setBusy(true);
    try {
      const cached = state?.identity === identity && state.resultId === resultId && !state.error && state.data
        ? { key: state.key, data: state.data } : null;
      const refreshed = await refreshSklandTraining(options, {
        accountId: options.accountId,
        uid: options.uid,
        sync: syncSklandTraining,
        isCurrent,
        cached,
        compute: async (operbox, sourceName) => {
          const payload = {
            layout: options.layout, operbox, sourceName, boxSource: "skland" as const,
            rotation: options.rotation,
            fiammetta_enable: effectiveFiammettaSetting(operbox, options.rotation, options.fiammettaEnabled),
          };
          let result;
          if (options.taskQueueEnabled) {
            const submitted = await submitPlanTask(payload);
            if (!isCurrent()) throw new Error("Training context changed.");
            result = await task.run(submitted);
          } else {
            result = await computePlan(payload);
          }
          return { trainingAdvice: result.trainingAdvice, profile: result.profile };
        },
      });
      if (!refreshed) {
        return;
      }
      const error = refreshed.error ? toDisplayError(refreshed.error, options.failureMessage) : null;
      if (error?.retryAfterSeconds) attempts.current.retryAt = Date.now() + error.retryAfterSeconds * 1_000;
      setState({
        identity, resultId, key: refreshed.key,
        data: refreshed.data ?? (state?.identity === identity && state.resultId === resultId ? state.data : null),
        syncedAt: Date.now(), error: error ? options.failureMessage : null,
      });
      options.onSynced(refreshed.session);
    } catch (cause) {
      if (!isCurrent()) {
        return;
      }
      const error = toDisplayError(cause, options.failureMessage);
      if (error.retryAfterSeconds) attempts.current.retryAt = Date.now() + error.retryAfterSeconds * 1_000;
      setState((previous) => ({
        identity, resultId, key,
        data: previous?.identity === identity && previous.resultId === resultId ? previous.data : null,
        syncedAt: previous?.identity === identity ? previous.syncedAt : null,
        error: options.failureMessage,
      }));
    } finally {
      if (isCurrent()) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  });

  useEffect(() => {
    if (!enabled || !active || blocked) return;
    void refresh(false);
    const check = () => { void refresh(false); };
    const timer = window.setInterval(check, 15_000);
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [enabled, active, blocked, context, busy]);

  useEffect(() => {
    if (!enabled || !active) return;
    const update = () => setRetryIn(attempts.current.identity === identity
      ? Math.max(0, Math.ceil((Math.max((attempts.current.last ?? 0) + 30_000, attempts.current.retryAt) - Date.now()) / 1_000))
      : 0);
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [enabled, active, identity]);

  useEffect(() => {
    if (handledManualRequest.current === manualRequest) return;
    handledManualRequest.current = manualRequest;
    void refresh(true);
  }, [manualRequest]);

  const requestRefresh = useCallback(() => setManualRequest((value) => value + 1), []);
  const current = enabled && state?.identity === identity && state.resultId === resultId ? state : null;
  return useMemo(() => ({
    data: current?.data ?? null,
    busy,
    disabled: blocked,
    retryIn,
    syncedAt: current?.syncedAt ?? null,
    error: task.pollStopped ? options.failureMessage : current?.error ?? null,
    stale: Boolean(current && (current.error || current.key !== key)),
    resume: task.pollStopped ? task.resume : null,
    resumeDisabled: task.resumeDisabled,
    refresh: requestRefresh,
  }), [current, busy, blocked, retryIn, task.pollStopped, task.resume, task.resumeDisabled, options.failureMessage, key, requestRefresh]);
}
