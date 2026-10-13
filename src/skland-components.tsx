"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useEffectEvent, useId, useRef, useState, type KeyboardEvent } from "react";
import {
  ExternalLink,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  ScanLine,
  ShieldCheck,
} from "lucide-react";

import { pollSklandQr, startSklandQr, toDisplayError } from "@/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { QrCodeFrame } from "@/components/ui/qr-code-frame";
import { cn } from "@/lib/utils";
import { buildSklandAppOpenUrl } from "@/skland-auth-url";
import { nextSklandQrPollDelay, remainingSklandQrPollDelay } from "@/skland-qr-polling";
import {
  currentSklandPolicyConsent,
  SklandPolicyConsent,
} from "@/skland-policy-consent";
import type { SklandSessionData } from "@/types";

// The encoder is only needed after the user requests a login QR code.
const QRCodeSVG = dynamic(() => import("qrcode.react").then((module) => module.QRCodeSVG), { ssr: false });

const SklandCredentialPanel = dynamic(
  () => import("@/skland-credential-panel").then((module) => module.SklandCredentialPanel),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
        <LoaderCircle className="animate-spin motion-reduce:animate-none" />正在加载凭证导入…
      </div>
    ),
  },
);

type ScanState = "idle" | "loading" | "waiting" | "scanned" | "expired";
type AuthMethod = "qr" | "credential";

const sklandQrStatusIconClassName = "text-neutral-700 [forced-color-adjust:none]";

interface SklandLoginPanelProps {
  configured: boolean;
  disabledReason?: string | null;
  onAuthenticated: (session: SklandSessionData) => void;
  className?: string;
  dialogPresentation?: boolean;
}

export function SklandLoginPanel({
  configured,
  disabledReason,
  onAuthenticated,
  className,
  dialogPresentation = false,
}: SklandLoginPanelProps) {
  const sklandAppOpenUrl = buildSklandAppOpenUrl();
  const [authMethod, setAuthMethod] = useState<AuthMethod>("qr");
  const [scanId, setScanId] = useState<string | null>(null);
  const [scanUrl, setScanUrl] = useState<string | null>(null);
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanExpiresAt, setScanExpiresAt] = useState<number | null>(null);
  const [preparingSlow, setPreparingSlow] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const authTabsId = useId();
  const createQrPromiseRef = useRef<Promise<void> | null>(null);
  const mountedRef = useRef(true);
  const consentReady = termsAccepted && privacyAccepted;
  const notifyAuthenticated = useEffectEvent(onAuthenticated);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const createQr = useCallback(() => {
    if (createQrPromiseRef.current) return createQrPromiseRef.current;
    const task = (async () => {
      setScanError(null);
      setScanState("loading");
      setScanId(null);
      setScanUrl(null);
      setScanExpiresAt(null);
      try {
        const result = await startSklandQr(currentSklandPolicyConsent());
        if (!mountedRef.current) return;
        setScanId(result.scanId);
        setScanUrl(result.scanUrl);
        setScanExpiresAt(Date.now() + result.expiresInSeconds * 1000);
        setScanState("waiting");
      } catch (error) {
        if (!mountedRef.current) return;
        const detail = toDisplayError(error, "二维码生成失败，请稍后重试。");
        setScanState("idle");
        setScanError(`${detail.message}（${detail.code}${detail.requestId ? ` · ${detail.requestId}` : ""}）`);
      }
    })();
    createQrPromiseRef.current = task;
    void task.finally(() => {
      if (createQrPromiseRef.current === task) createQrPromiseRef.current = null;
    });
    return task;
  }, []);

  useEffect(() => {
    if (scanState !== "loading") {
      setPreparingSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setPreparingSlow(true), 2_000);
    return () => window.clearTimeout(timer);
  }, [scanState]);

  useEffect(() => {
    if (!scanId || !scanExpiresAt) return;
    const remaining = scanExpiresAt - Date.now();
    if (remaining <= 0) {
      setScanId(null);
      setScanState("expired");
      return;
    }
    const timer = window.setTimeout(() => {
      setScanId(null);
      setScanState("expired");
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [scanExpiresAt, scanId]);

  useEffect(() => {
    if (!scanId || !scanExpiresAt || authMethod !== "qr") return;
    let cancelled = false;
    let timer: number | null = null;
    let pollInFlight = false;
    let failedAttempts = 0;
    let nextPollAt: number | null = null;
    let activePollController: AbortController | null = null;

    const clearTimer = () => {
      if (timer === null) return;
      window.clearTimeout(timer);
      timer = null;
    };

    const canPoll = () => !document.hidden && navigator.onLine && Date.now() < scanExpiresAt;

    const armTimer = (delayMs: number) => {
      clearTimer();
      timer = window.setTimeout(() => {
        timer = null;
        nextPollAt = null;
        void poll();
      }, delayMs);
    };

    const scheduleNext = (retryAfterSeconds?: number) => {
      clearTimer();
      if (cancelled || Date.now() >= scanExpiresAt) return;
      const delay = nextSklandQrPollDelay({
        failedAttempts,
        expiresAt: scanExpiresAt,
        retryAfterSeconds,
      });
      if (delay === null) {
        nextPollAt = null;
        return;
      }
      nextPollAt = Date.now() + delay;
      if (!canPoll()) return;
      armTimer(delay);
    };

    const poll = async () => {
      clearTimer();
      if (cancelled || pollInFlight || !canPoll()) return;
      pollInFlight = true;
      const controller = new AbortController();
      activePollController = controller;
      let shouldContinue = true;
      let retryAfterSeconds: number | undefined;
      try {
        const result = await pollSklandQr(scanId, controller.signal);
        if (cancelled) return;
        failedAttempts = 0;
        if (
          result.status === "authenticated"
          && result.scheduleSnapshot
          && result.accounts
          && result.activeAccountId
        ) {
          shouldContinue = false;
          notifyAuthenticated({
            authenticated: true,
            configured: true,
            authMethods: { qr: true, credential: true },
            accounts: result.accounts,
            activeAccountId: result.activeAccountId,
            bindingCount: result.bindingCount ?? result.accounts.length,
            bindingSummary: result.bindingSummary,
            scheduleSnapshot: result.scheduleSnapshot,
            statusSnapshot: result.statusSnapshot,
          });
          setScanId(null);
          setScanUrl(null);
          setScanExpiresAt(null);
          setScanState("idle");
          setScanError(null);
          return;
        }
        if (result.status === "expired") {
          setScanId(null);
          setScanState("expired");
          setScanError(null);
          shouldContinue = false;
          return;
        }
        setScanState(result.status === "scanned" ? "scanned" : "waiting");
        setScanError(null);
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        const detail = toDisplayError(error, "登录状态查询失败，将继续重试。");
        setScanError(`${detail.message}（${detail.code}${detail.requestId ? ` · ${detail.requestId}` : ""}）`);
        failedAttempts += 1;
        retryAfterSeconds = detail.retryAfterSeconds;
        shouldContinue = detail.retryable;
      } finally {
        if (activePollController === controller) activePollController = null;
        pollInFlight = false;
        if (!cancelled && shouldContinue) scheduleNext(retryAfterSeconds);
      }
    };

    const resumePolling = () => {
      clearTimer();
      if (cancelled || pollInFlight || document.hidden || !navigator.onLine) return;
      if (Date.now() >= scanExpiresAt) {
        setScanId(null);
        setScanState("expired");
        return;
      }
      const delay = remainingSklandQrPollDelay({ nextPollAt, expiresAt: scanExpiresAt });
      if (delay === null) {
        setScanId(null);
        setScanState("expired");
      } else if (delay === 0) {
        nextPollAt = null;
        void poll();
      } else {
        armTimer(delay);
      }
    };
    const handleVisibilityChange = () => {
      if (document.hidden) clearTimer();
      else resumePolling();
    };
    const handleOffline = () => clearTimer();

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", resumePolling);
    window.addEventListener("offline", handleOffline);
    scheduleNext();
    return () => {
      cancelled = true;
      clearTimer();
      activePollController?.abort();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", resumePolling);
      window.removeEventListener("offline", handleOffline);
    };
  }, [authMethod, scanExpiresAt, scanId]);

  useEffect(() => {
    if (
      authMethod !== "qr"
      || dialogPresentation
      || !configured
      || !consentReady
      || scanError
      || (scanState !== "idle" && scanState !== "expired")
    ) {
      return;
    }
    void createQr();
  }, [authMethod, configured, consentReady, createQr, dialogPresentation, scanError, scanState]);

  function handleAuthTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const nextMethod = event.key === "ArrowLeft" || event.key === "ArrowUp" || event.key === "Home"
      ? "qr"
      : event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "End"
        ? "credential"
        : null;
    if (!nextMethod) return;
    event.preventDefault();
    setAuthMethod(nextMethod);
    window.requestAnimationFrame(() => document.getElementById(`${authTabsId}-${nextMethod}-tab`)?.focus());
  }

  const pageStatusText = scanState === "loading"
    ? preparingSlow ? "正在连接登录服务，请稍候…" : "正在生成二维码…"
    : scanState === "scanned"
      ? "已扫码，正在等待森空岛 App 确认并完成登录…"
      : scanState === "expired"
        ? dialogPresentation ? "二维码已过期，请重新生成。" : "二维码已过期，正在刷新…"
        : scanUrl
          ? "请使用森空岛 App 扫描二维码"
          : dialogPresentation ? "准备好后生成二维码。" : "勾选下方两项授权后显示二维码";

  return (
    <Card
      className={cn(
        "w-full overflow-hidden rounded-none border-0 bg-transparent shadow-none ring-0",
        className,
      )}
      data-skland-login-panel
    >
      <div className="grid gap-6 px-5 py-6 sm:px-8 sm:py-8">
        {!configured ? (
          <Alert>
            <AlertDescription>{disabledReason ?? "当前未开放森空岛登录，可继续使用 MAA 导入。"}</AlertDescription>
          </Alert>
        ) : (
          <div>
            <div className="mx-auto grid min-h-11 w-full max-w-xl grid-cols-2 rounded-lg bg-muted p-1 text-muted-foreground" role="tablist" aria-label="森空岛登录方式">
              {(["qr", "credential"] as const).map((method) => (
                <button
                  key={method}
                  id={`${authTabsId}-${method}-tab`}
                  type="button"
                  role="tab"
                  aria-selected={authMethod === method}
                  aria-controls={`${authTabsId}-${method}-panel`}
                  tabIndex={authMethod === method ? 0 : -1}
                  className={cn(
                    "flex min-h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    authMethod === method && "bg-background text-foreground shadow-sm",
                  )}
                  onClick={() => setAuthMethod(method)}
                  onKeyDown={handleAuthTabKeyDown}
                >
                  {method === "qr" ? <><ScanLine />扫码登录</> : <><KeyRound />凭证导入</>}
                </button>
              ))}
            </div>

            {authMethod === "qr" ? (
            <div id={`${authTabsId}-qr-panel`} role="tabpanel" aria-labelledby={`${authTabsId}-qr-tab`} className="mt-4">
              <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_15rem] md:items-center" data-skland-login-qr>
                <div className="order-2 grid gap-4 md:order-1">
                  <p className="flex items-start gap-2 text-sm leading-6 text-muted-foreground">
                    <ShieldCheck className="mt-1 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
                    <span>推荐方式。打开森空岛 App 扫描二维码，确认后同步当前角色的干员、基建与状态中心数据。</span>
                  </p>
                  <SklandPolicyConsent
                    termsAccepted={termsAccepted}
                    privacyAccepted={privacyAccepted}
                    onTermsChange={setTermsAccepted}
                    onPrivacyChange={setPrivacyAccepted}
                  />
                  {scanError ? <Alert variant="destructive"><AlertDescription>{scanError}</AlertDescription></Alert> : null}
                  {scanUrl ? (
                    <div className="grid gap-2 sm:hidden">
                      <Button
                        nativeButton={false}
                        render={<a data-motion-pressable href={sklandAppOpenUrl} target="_blank" rel="noreferrer" />}
                        size={dialogPresentation ? "dialog" : "default"}
                        className="w-full"
                      >
                        <ExternalLink />打开森空岛 App
                      </Button>
                      <p className="text-pretty text-center text-xs leading-5 text-muted-foreground">
                        请用森空岛扫描二维码；必要时可在另一台设备展示。
                      </p>
                    </div>
                  ) : null}
                  {!scanUrl || scanState === "expired" || scanError ? (
                    <Button
                      type="button"
                      size={dialogPresentation ? "dialog" : "default"}
                      className={cn("w-full sm:w-fit", dialogPresentation && "sm:w-[196px]")}
                      variant={scanState === "idle" && !scanError ? "default" : "outline"}
                      disabled={scanState === "loading" || !consentReady}
                      onClick={() => void createQr()}
                    >
                      {scanState === "loading" ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                      {scanState === "idle" && !scanError ? "生成登录二维码" : "重新生成二维码"}
                    </Button>
                  ) : null}
                </div>

                <div className="order-1 grid place-items-center gap-3 md:order-2">
                  <QrCodeFrame data-skland-qr-visual>
                    {scanState === "scanned" ? (
                      <LoaderCircle
                        className={cn("size-9 animate-spin motion-reduce:animate-none", sklandQrStatusIconClassName)}
                        aria-hidden="true"
                        data-skland-login-progress
                        data-skland-login-status-icon="scanned"
                      />
                    ) : scanUrl ? (
                      <QRCodeSVG
                        value={scanUrl}
                        size={196}
                        bgColor="#FFFFFF"
                        fgColor="#000000"
                        className="size-full"
                        title="森空岛登录二维码"
                        role="img"
                        aria-label="森空岛登录二维码"
                      />
                    ) : scanState === "loading" ? (
                      <LoaderCircle
                        className={cn("size-8 animate-spin motion-reduce:animate-none", sklandQrStatusIconClassName)}
                        aria-hidden="true"
                        data-skland-login-status-icon="loading"
                      />
                    ) : (
                      <ScanLine
                        className={cn("size-12", sklandQrStatusIconClassName)}
                        aria-hidden="true"
                        data-skland-login-status-icon="idle"
                      />
                    )}
                  </QrCodeFrame>
                  <p className="text-center text-sm leading-6 text-muted-foreground" role="status" aria-live="polite">{pageStatusText}</p>
                </div>
              </div>
            </div>
            ) : null}

            {authMethod === "credential" ? (
            <div id={`${authTabsId}-credential-panel`} role="tabpanel" aria-labelledby={`${authTabsId}-credential-tab`} className="mx-auto mt-5 w-full max-w-3xl" data-skland-credential-panel>
              <SklandCredentialPanel
                dialogPresentation={dialogPresentation}
                onAuthenticated={onAuthenticated}
              />
            </div>
            ) : null}
          </div>
        )}
      </div>
    </Card>
  );
}
