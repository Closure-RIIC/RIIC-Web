import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";

import { pollSklandQr, startSklandQr, toDisplayError } from "@/api";
import { currentSklandPolicyConsent } from "@/skland-policy-consent";
import { nextSklandQrPollDelay, remainingSklandQrPollDelay } from "@/skland-qr-polling";
import type { DisplayError, SklandSessionData } from "@riic/arknights-domain/types";

type ScanState = "idle" | "waiting" | "scanned" | "processing" | "expired" | "error" | "authenticated";
type Scan = { id: string; url: string; expiresAt: number };
type ScanError = { kind: "generation" | "query" | "timeout"; detail?: DisplayError };

/** Own the lifetime of a QR attempt independently of presentation and locale. */
export function useSklandQr({ active, autoStart, onAuthenticated }: {
  active: boolean;
  autoStart: boolean;
  onAuthenticated: (session: SklandSessionData) => void;
}) {
  const [scan, setScan] = useState<Scan | null>(null);
  const [state, setState] = useState<ScanState>("idle");
  const [error, setError] = useState<ScanError | null>(null);
  const [creating, setCreating] = useState(false);
  const [refreshAt, setRefreshAt] = useState(0);
  const [refreshSeconds, setRefreshSeconds] = useState(0);
  const revision = useRef(0);
  const mounted = useRef(true);
  const createController = useRef<AbortController | null>(null);
  const notifyAuthenticated = useEffectEvent(onAuthenticated);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      revision.current += 1;
      createController.current?.abort();
    };
  }, []);

  useEffect(() => {
    const update = () => setRefreshSeconds(Math.max(0, Math.ceil((refreshAt - Date.now()) / 1_000)));
    update();
    if (refreshAt <= Date.now()) return;
    const timer = window.setInterval(() => {
      update();
      if (Date.now() >= refreshAt) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [refreshAt]);

  const createQr = useCallback(async () => {
    if (createController.current || Date.now() < refreshAt) return;
    const currentRevision = ++revision.current;
    const controller = new AbortController();
    createController.current = controller;
    setCreating(true);
    setError(null);
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 40_000);
    try {
      const result = await startSklandQr(currentSklandPolicyConsent(), controller.signal);
      if (!mounted.current || currentRevision !== revision.current) return;
      setScan({ id: result.scanId, url: result.scanUrl, expiresAt: Date.now() + result.expiresInSeconds * 1_000 });
      setRefreshAt(Date.now() + (result.refreshAfterSeconds ?? 10) * 1_000);
      setState("waiting");
    } catch (cause) {
      if (!mounted.current || currentRevision !== revision.current) return;
      const detail = toDisplayError(cause, "");
      setError(timedOut ? { kind: "timeout" } : { kind: "generation", detail });
      if (detail.retryAfterSeconds) setRefreshAt(Date.now() + detail.retryAfterSeconds * 1_000);
      // A refused refresh must leave the existing QR and its polling usable.
    } finally {
      window.clearTimeout(timeout);
      if (createController.current === controller) createController.current = null;
      if (mounted.current) setCreating(false);
    }
  }, [refreshAt]);

  useEffect(() => {
    if (active && autoStart && state === "idle" && !creating && !error) void createQr();
  }, [active, autoStart, state, creating, error, createQr]);

  useEffect(() => {
    if (!scan) return;
    const expire = () => {
      setScan(null);
      setState("expired");
    };
    const timer = window.setTimeout(expire, Math.max(0, scan.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [scan]);

  useEffect(() => {
    if (!active || !scan || creating) return;
    const { id: scanId, expiresAt } = scan;
    const currentRevision = revision.current;
    let cancelled = false;
    let stopped = false;
    let timer: number | null = null;
    let failedAttempts = 0;
    let nextPollAt: number | null = null;
    let activePollController: AbortController | null = null;
    const isCurrent = () => !cancelled && revision.current === currentRevision && Date.now() < expiresAt;
    const clearTimer = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };
    const canPoll = () => isCurrent() && !stopped && !document.hidden && navigator.onLine;
    const armTimer = (delay: number) => {
      clearTimer();
      timer = window.setTimeout(() => { nextPollAt = null; void poll(); }, delay);
    };
    const scheduleNext = (retryAfterSeconds?: number) => {
      clearTimer();
      if (!isCurrent() || stopped) return;
      const delay = nextSklandQrPollDelay({ failedAttempts, expiresAt, retryAfterSeconds });
      if (delay === null) return;
      nextPollAt = Date.now() + delay;
      if (canPoll()) armTimer(delay);
    };
    const stop = () => {
      stopped = true;
      setScan(null);
      setState("error");
    };
    const poll = async () => {
      clearTimer();
      if (!canPoll() || activePollController) return;
      const controller = new AbortController();
      activePollController = controller;
      let timedOut = false;
      let retryAfterSeconds: number | undefined;
      const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 35_000);
      try {
        const result = await pollSklandQr(scanId, controller.signal);
        if (!isCurrent()) return;
        failedAttempts = 0;
        if (result.status === "authenticated") {
          if (!result.scheduleSnapshot || !result.accounts || !result.activeAccountId) {
            setError({ kind: "query" });
            stop();
            return;
          }
          stopped = true;
          setScan(null);
          setState("authenticated");
          setError(null);
          notifyAuthenticated({
            authenticated: true, configured: true, authMethods: { qr: true, credential: true },
            accounts: result.accounts, activeAccountId: result.activeAccountId,
            bindingCount: result.bindingCount ?? result.accounts.length, bindingSummary: result.bindingSummary,
            scheduleSnapshot: result.scheduleSnapshot, statusSnapshot: result.statusSnapshot,
          });
          return;
        }
        if (result.status === "expired") {
          stopped = true;
          setScan(null);
          setState("expired");
          setError(null);
          return;
        }
        setState((current) => result.processing ? "processing"
          : result.status === "scanned" && current !== "processing" ? "scanned" : current);
        // A successful status query does not dismiss an unsuccessful refresh.
        setError((current) => current?.kind === "generation" ? current : null);
      } catch (cause) {
        if (!isCurrent() || (controller.signal.aborted && !timedOut)) return;
        const detail = toDisplayError(cause, "");
        setError(timedOut ? { kind: "timeout" } : { kind: "query", detail });
        failedAttempts += 1;
        retryAfterSeconds = detail.retryAfterSeconds;
        if (!detail.retryable || failedAttempts >= 3) stop();
      } finally {
        window.clearTimeout(timeout);
        if (activePollController === controller) activePollController = null;
        scheduleNext(retryAfterSeconds);
      }
    };
    const resumePolling = () => {
      clearTimer();
      if (!canPoll() || activePollController) return;
      const delay = remainingSklandQrPollDelay({ nextPollAt, expiresAt });
      if (delay === null) return;
      if (delay === 0) void poll();
      else armTimer(delay);
    };
    const handleVisibilityChange = () => {
      if (document.hidden) clearTimer();
      else resumePolling();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", resumePolling);
    window.addEventListener("offline", clearTimer);
    scheduleNext();
    return () => {
      cancelled = true;
      clearTimer();
      activePollController?.abort();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", resumePolling);
      window.removeEventListener("offline", clearTimer);
    };
  }, [active, scan, creating]);

  return { scan, state, error, creating, refreshSeconds, createQr };
}
