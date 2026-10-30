"use client";

import { lazyWithMessages } from "@/i18n/features-client";
import { useLocale as useRawLocale } from "use-intl";
import { createLocalizer as createRawLocalizer, richValue } from "@riic/arknights-domain/i18n/localize";
import type RawMessages from "../messages/zh-CN/AK_Raw_skland_components.json";
const rawText = createRawLocalizer<typeof RawMessages>("AK_Raw_skland_components");


import { lazy, Suspense } from "react";
import { ClientOnly } from "@tanstack/react-router";
import { useEffect, useId, useState, type KeyboardEvent } from "react";
import {
  ExternalLink,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  ScanLine,
  ShieldCheck,
} from "lucide-react";

import { useSklandQr } from "@/use-skland-qr";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { QrCodeFrame } from "@/components/ui/qr-code-frame";
import { cn } from "@/lib/utils";
import { buildSklandAppOpenUrl } from "@/skland-auth-url";
import {
  SklandPolicyConsent,
} from "@/skland-policy-consent";
import type { SklandSessionData } from "@riic/arknights-domain/types";

// The encoder is only needed after the user requests a login QR code.
const LazyQrCode = lazy(() => import("qrcode.react").then((module) => ({ default: module.QRCodeSVG })));
function QRCodeSVG(props: React.ComponentProps<typeof LazyQrCode>) {
  return <ClientOnly><Suspense fallback={null}><LazyQrCode {...props} /></Suspense></ClientOnly>;
}
const LazyCredentialPanel = lazyWithMessages(() => import("@/skland-credential-panel").then((module) => ({ default: module.SklandCredentialPanel })), "apps/arknights/src/skland-credential-panel.tsx");
function SklandCredentialPanel(props: React.ComponentProps<typeof LazyCredentialPanel>) {
  const rawLocale = useRawLocale();
  const fallback = <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">{rawText.rich(rawLocale, "loadingCredentialImport", { part1: richValue((<LoaderCircle className="animate-spin motion-reduce:animate-none" />)) })}</div>;
  return <ClientOnly fallback={fallback}><Suspense fallback={fallback}><LazyCredentialPanel {...props} /></Suspense></ClientOnly>;
}

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
  const rawLocale = useRawLocale();
  const sklandAppOpenUrl = buildSklandAppOpenUrl();
  const [authMethod, setAuthMethod] = useState<AuthMethod>("qr");
  const [preparingSlow, setPreparingSlow] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const authTabsId = useId();
  const consentReady = termsAccepted && privacyAccepted;
  const { scan, state: scanState, error: scanError, creating, refreshSeconds, createQr } = useSklandQr({
    active: authMethod === "qr" && configured,
    autoStart: consentReady && !dialogPresentation,
    onAuthenticated,
  });
  const scanUrl = scan?.url;
  const processing = scanState === "scanned" || scanState === "processing";
  const errorText = scanError?.kind === "timeout" ? rawText.text(rawLocale, "requestTimeout")
    : scanError?.detail?.message || (scanError?.kind === "generation"
      ? rawText.text(rawLocale, "qrFailed") : rawText.text(rawLocale, "pollFailed"));

  useEffect(() => {
    if (!creating) {
      setPreparingSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setPreparingSlow(true), 2_000);
    return () => window.clearTimeout(timer);
  }, [creating]);

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

  const pageStatusText = creating
    ? preparingSlow ? rawText.text(rawLocale, "connecting") : rawText.text(rawLocale, "generating")
    : scanState === "processing"
      ? rawText.text(rawLocale, "processing")
      : scanState === "scanned"
        ? rawText.text(rawLocale, "scanned")
        : scanState === "expired"
          ? rawText.text(rawLocale, "expired")
          : scanState === "error" || (scanError && !scanUrl)
            ? rawText.text(rawLocale, "stopped")
            : scanUrl
              ? rawText.text(rawLocale, "scanPrompt")
              : dialogPresentation ? rawText.text(rawLocale, "readyPrompt") : rawText.text(rawLocale, "consentPrompt");

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
            <AlertDescription>{disabledReason ?? rawText.text(rawLocale, "sklandSignInIsCurrentlyUnavailableYouCanContinue")}</AlertDescription>
          </Alert>
        ) : (
          <div>
            <div className="mx-auto grid min-h-11 w-full max-w-xl grid-cols-2 rounded-lg bg-muted p-1 text-muted-foreground" role="tablist" aria-label={rawText.text(rawLocale, "sklandSignInMethod")}>
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
                  {method === "qr" ? <>{rawText.rich(rawLocale, "qrSignIn", { part1: richValue((<ScanLine />)) })}</> : <>{rawText.rich(rawLocale, "importCredential", { part1: richValue((<KeyRound />)) })}</>}
                </button>
              ))}
            </div>

            {authMethod === "qr" ? (
            <div id={`${authTabsId}-qr-panel`} role="tabpanel" aria-labelledby={`${authTabsId}-qr-tab`} className="mt-4">
              <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_15rem] md:items-center" data-skland-login-qr>
                <div className="order-2 grid gap-4 md:order-1">
                  <p className="flex items-start gap-2 text-sm leading-6 text-muted-foreground">
                    <ShieldCheck className="mt-1 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
                    <span>{rawText.text(rawLocale, "recommendedScanTheQrCodeWithTheSklandApp")}</span>
                  </p>
                  <SklandPolicyConsent
                    termsAccepted={termsAccepted}
                    privacyAccepted={privacyAccepted}
                    onTermsChange={setTermsAccepted}
                    onPrivacyChange={setPrivacyAccepted}
                  />
                  {scanError ? <Alert variant="destructive"><AlertDescription>{errorText}{scanError.detail ? `（${scanError.detail.code}${scanError.detail.requestId ? ` · ${scanError.detail.requestId}` : ""}）` : ""}</AlertDescription></Alert> : null}
                  {scanUrl ? (
                    <div className="grid gap-2 sm:hidden">
                      <Button
                        nativeButton={false}
                        render={<a data-motion-pressable href={sklandAppOpenUrl} target="_blank" rel="noreferrer" />}
                        size={dialogPresentation ? "dialog" : "default"}
                        className="w-full"
                      >{rawText.rich(rawLocale, "openSklandApp", { part1: richValue((<ExternalLink />)) })}</Button>
                      <p className="text-pretty text-center text-xs leading-5 text-muted-foreground">{rawText.text(rawLocale, "scanWithSklandDisplayThisCodeOnAnotherDevice")}</p>
                    </div>
                  ) : null}
                </div>

                <div className="order-1 grid place-items-center gap-3 md:order-2">
                  <QrCodeFrame data-skland-qr-visual>
                    {creating || processing ? (
                      <LoaderCircle
                        className={cn("size-9 animate-spin motion-reduce:animate-none", sklandQrStatusIconClassName)}
                        aria-hidden="true"
                        data-skland-login-progress
                        data-skland-login-status-icon={creating ? "loading" : "scanned"}
                      />
                    ) : scanUrl ? (
                      <QRCodeSVG
                        value={scanUrl}
                        size={196}
                        bgColor="#FFFFFF"
                        fgColor="#000000"
                        className="size-full"
                        title={rawText.text(rawLocale, "sklandLoginQrCode")}
                        role="img"
                        aria-label={rawText.text(rawLocale, "sklandLoginQrCode")}
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
                  <div className="grid justify-items-center gap-2 text-center">
                    <Button
                      data-skland-qr-refresh
                      type="button"
                      size={dialogPresentation ? "dialog" : "default"}
                      className={dialogPresentation ? "w-[196px]" : undefined}
                      variant={scanState === "idle" && !scanError ? "default" : "outline"}
                      disabled={creating || !consentReady || refreshSeconds > 0}
                      onClick={() => void createQr()}
                    >
                      {creating ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <RefreshCw />}
                      {scanState === "idle" && !scanError ? rawText.text(rawLocale, "generateLoginQrCode") : processing ? rawText.text(rawLocale, "scanAgain") : rawText.text(rawLocale, "generateANewQrCode")}
                    </Button>
                    {refreshSeconds > 0 ? <p className="text-xs text-muted-foreground" data-skland-qr-cooldown>{rawText.text(rawLocale, "refreshCooldown", { seconds: refreshSeconds })}</p> : null}
                  </div>
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
