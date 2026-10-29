import { lazy, Suspense, useEffect, useEffectEvent, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ClientOnly } from "@tanstack/react-router";
import { Check, Clipboard, ExternalLink, KeyRound, LoaderCircle, RefreshCw, ScanLine, ShieldCheck, TriangleAlert } from "lucide-react";
import { Action, ActionLink, Notice } from "@riic/endfield-ui";
import type { EndfieldRole } from "@riic/endfield-skland/model";
import { PRIVACY_VERSION, TERMS_VERSION } from "@riic/platform/legal-policy";
import { buildSklandAppOpenUrl } from "@riic/platform/skland-auth-url";
import { nextSklandQrPollDelay } from "@riic/platform/skland-qr-polling";
import { sklandApi, SklandRequestError } from "../skland-client";
import { sklandErrorKey, type SklandFeedbackKey } from "../skland-feedback";
import { sklandFeedbackText } from "../skland-feedback-text";
import { useWorkspace } from "../state";

const QrCode = lazy(() => import("qrcode.react").then(module => ({ default: module.QRCodeSVG })));
const COPY_CREDENTIAL = "copy(localStorage.getItem('SK_OAUTH_CRED_KEY')+','+localStorage.getItem('SK_TOKEN_CACHE_KEY'))";
const consent = () => ({ termsAccepted: true, privacyAccepted: true, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION });
export type EndfieldLogin = { accountId: string; roles: EndfieldRole[] };
type Scan = { scanId: string; scanUrl: string; expiresAt: number };

/** Same layout and interaction pattern as Arknights, with Endfield-only endpoints. */
export function SklandLoginPanel({ main, onAuthenticated, onMethodChange, renderDialog }: {
  main: string; onAuthenticated: (value: EndfieldLogin) => void; onMethodChange: () => void;
  renderDialog?: (body: ReactNode, actions: ReactNode) => ReactNode;
}) {
  const { t } = useWorkspace();
  const copyCommand = `${COPY_CREDENTIAL},console.log(${JSON.stringify(t("SklandLoginPanel.credentialCopied"))})`;
  const [method, setMethod] = useState<"qr" | "credential">("qr");
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [credential, setCredential] = useState("");
  const [scan, setScan] = useState<Scan | null>(null);
  const [scanState, setScanState] = useState<"idle" | "waiting" | "scanned" | "expired">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SklandFeedbackKey | "">("");
  const [copied, setCopied] = useState(false);
  const tabs = useId();
  const request = useRef<AbortController | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);
  const notify = useEffectEvent(onAuthenticated);
  const canSubmit = terms && privacy;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); if (copyTimer.current) clearTimeout(copyTimer.current); };
  }, []);

  function changeMethod(next: typeof method) {
    if (next === method) return;
    request.current?.abort(); request.current = null;
    setMethod(next); setScan(null); setScanState("idle"); setBusy(false); setError(""); setCredential("");
    onMethodChange();
  }
  function handleKey(event: KeyboardEvent<HTMLButtonElement>) {
    const next = ["ArrowLeft", "ArrowUp", "Home"].includes(event.key) ? "qr"
      : ["ArrowRight", "ArrowDown", "End"].includes(event.key) ? "credential" : null;
    if (!next) return;
    event.preventDefault(); changeMethod(next);
    document.getElementById(`${tabs}-${next}`)?.focus();
  }
  async function submit() {
    if (!canSubmit || request.current || (method === "credential" && !credential.trim())) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(""); setScan(null);
    const submitted = credential; setCredential("");
    try {
      if (method === "qr") {
        const result = await sklandApi<{ scanId: string; scanUrl: string; expiresInSeconds: number }>("qr", controller.signal, { consent: consent() });
        if (controller.signal.aborted) return;
        setScan({ ...result, expiresAt: Date.now() + result.expiresInSeconds * 1000 }); setScanState("waiting");
      } else {
        const result = await sklandApi<EndfieldLogin>("credential", controller.signal, { credential: submitted, consent: consent() });
        if (!controller.signal.aborted) onAuthenticated(result);
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(sklandErrorKey(cause, "SklandLoginPanel.signInFailedPleaseRetry"));
    } finally {
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  }
  const startWhenReady = useEffectEvent(submit);
  useEffect(() => {
    if (method === "qr" && canSubmit && !scan && !busy && !error && (scanState === "idle" || scanState === "expired")) {
      void startWhenReady();
    }
  }, [method, canSubmit, scan, busy, error, scanState]);
  // Poll only while visible and online. Reuse the existing backoff and expiry policy.
  useEffect(() => {
    if (!scan || method !== "qr" || !canSubmit) return;
    let stopped = false, inFlight = false, failures = 0;
    let due = Date.now() + 6000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active: AbortController | undefined;
    const expire = () => { stopped = true; active?.abort(); clearTimeout(timer); setScan(null); setScanState("expired"); };
    const expiry = setTimeout(expire, Math.max(0, scan.expiresAt - Date.now()));
    const schedule = () => {
      clearTimeout(timer);
      if (stopped || inFlight || document.hidden || !navigator.onLine) return;
      if (Date.now() >= scan.expiresAt) { expire(); return; }
      timer = setTimeout(() => void poll(), Math.max(0, due - Date.now()));
    };
    const poll = async () => {
      if (stopped || inFlight || document.hidden || !navigator.onLine) return;
      inFlight = true; active = new AbortController();
      let retryAfterSeconds: number | undefined;
      try {
        const value = await sklandApi<Partial<EndfieldLogin> & { status: string }>("qr-status", active.signal, { scanId: scan.scanId });
        if (stopped || active.signal.aborted) return;
        failures = 0; setError("");
        if (value.status === "authenticated" && value.accountId && value.roles) {
          stopped = true; clearTimeout(expiry); setScan(null); setScanState("idle");
          notify({ accountId: value.accountId, roles: value.roles }); return;
        }
        if (value.status === "expired") { expire(); return; }
        setScanState(value.status === "scanned" ? "scanned" : "waiting");
      } catch (cause) {
        if (stopped || active.signal.aborted) return;
        setError(sklandErrorKey(cause, "SklandLoginPanel.pollFailed"));
        failures++;
        if (cause instanceof SklandRequestError) {
          retryAfterSeconds = cause.retryAfterSeconds;
          if (!cause.retryable) { stopped = true; clearTimeout(expiry); setScan(null); setScanState("idle"); }
        }
      } finally {
        inFlight = false;
        const delay = nextSklandQrPollDelay({ failedAttempts: failures, expiresAt: scan.expiresAt, retryAfterSeconds });
        if (!stopped && delay !== null) { due = Date.now() + delay; schedule(); }
      }
    };
    const pause = () => clearTimeout(timer);
    const visibility = () => { if (document.hidden) pause(); else schedule(); };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", schedule); window.addEventListener("offline", pause);
    schedule();
    return () => {
      stopped = true; clearTimeout(timer); clearTimeout(expiry); active?.abort();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", schedule); window.removeEventListener("offline", pause);
    };
  }, [scan, method, canSubmit]);

  function updateConsent(kind: "terms" | "privacy", value: boolean) {
    if (kind === "terms") setTerms(value); else setPrivacy(value);
    if (!value) { request.current?.abort(); request.current = null; setBusy(false); setScan(null); setScanState("idle"); }
  }
  const policies = <div className="ef-login-consent" data-skland-policy-consent>
    <label><input type="checkbox" checked={terms} onChange={e => updateConsent("terms", e.target.checked)} /><span>{t("SklandLoginPanel.iHaveReadAndAgreeToThe")} <a href={`${main}terms`} target="_blank" rel="noreferrer">{t("SklandLoginPanel.termsOfService")}</a>。</span></label>
    <label><input type="checkbox" checked={privacy} onChange={e => updateConsent("privacy", e.target.checked)} /><span>{t("SklandLoginPanel.iHaveReadThe")} <a href={`${main}privacy`} target="_blank" rel="noreferrer">{t("SklandLoginPanel.privacyPolicy")}</a>{t("SklandLoginPanel.andConsentToProcessingMySklandCredentialsCharacterOperators")}</span></label>
  </div>;
  const status = busy ? t("SklandLoginPanel.preparingQrCode") : scanState === "scanned" ? t("SklandLoginPanel.scannedConfirmInTheSklandApp")
    : scanState === "expired" ? t("SklandLoginPanel.qrCodeExpiredGenerateANewOne")
      : scan ? t("SklandLoginPanel.scanWithTheSklandApp") : t("SklandLoginPanel.acceptBothPoliciesToGenerateAQrCode");
  const actions = method === "qr"
    ? !scan || error ? <Action size={renderDialog ? "sm" : "default"} variant="yellow" icon={busy ? <LoaderCircle className="ef-spin" /> : <RefreshCw />} aria-busy={busy} disabled={busy || !canSubmit} onClick={() => void submit()}>{scanState === "idle" && !error ? t("SklandLoginPanel.generateLoginQrCode") : t("SklandLoginPanel.generateANewQrCode")}</Action> : null
    : <Action size={renderDialog ? "sm" : "default"} variant="yellow" type="submit" form={`${tabs}-credential-form`} icon={busy ? <LoaderCircle className="ef-spin" /> : <KeyRound />} aria-busy={busy} disabled={!canSubmit || !credential.trim() || busy}>{busy ? t("SklandLoginPanel.verifyingCredential") : t("SklandLoginPanel.importSignIn")}</Action>;
  const body = <div className="ef-login-panel" data-skland-login-panel>
    <div className="ef-login-tabs" role="tablist" aria-label={t("SklandLoginPanel.sklandSignInMethod")}>
      {(["qr", "credential"] as const).map(value => <button key={value} id={`${tabs}-${value}`} type="button" role="tab" aria-selected={method === value} aria-controls={`${tabs}-${value}-panel`} tabIndex={method === value ? 0 : -1} onClick={() => changeMethod(value)} onKeyDown={handleKey}>
        {value === "qr" ? <ScanLine /> : <KeyRound />}{value === "qr" ? t("SklandLoginPanel.qrSignIn") : t("SklandLoginPanel.credentialImport")}
      </button>)}
    </div>
    <div id={`${tabs}-${method}-panel`} role="tabpanel" aria-labelledby={`${tabs}-${method}`}>
      {method === "qr" ? <div className="ef-login-qr" data-skland-login-qr>
        <div className="ef-login-instructions">
          <p className="ef-login-recommend"><ShieldCheck aria-hidden="true" /><span>{t("SklandLoginPanel.recommendedScanWithTheSklandAppToConnectYour")}</span></p>
          {policies}
          {error ? <Notice error>{sklandFeedbackText(error, t)}</Notice> : null}
          {scan ? <div className="ef-login-app"><ActionLink href={buildSklandAppOpenUrl()} target="_blank" rel="noreferrer" icon={<ExternalLink />}>{t("SklandLoginPanel.openSklandApp")}</ActionLink><p>{t("SklandLoginPanel.scanWithSklandDisplayThisCodeOnAnotherDevice")}</p></div> : null}
          {!renderDialog ? actions : null}
        </div>
        <div className="ef-login-visual">
          <div className="ef-qr-frame" data-skland-qr-visual>
            {scanState === "scanned" || busy ? <LoaderCircle className="ef-spin" aria-hidden="true" /> : scan ? <ClientOnly><Suspense fallback={<LoaderCircle className="ef-spin" />}><QrCode value={scan.scanUrl} size={196} bgColor="#fff" fgColor="#000" title={t("SklandLoginPanel.sklandLoginQrCode")} role="img" aria-label={t("SklandLoginPanel.sklandLoginQrCode")} /></Suspense></ClientOnly> : <ScanLine aria-hidden="true" />}
          </div>
          <p role="status" aria-live="polite">{status}</p>
        </div>
      </div> : <form id={`${tabs}-credential-form`} className="ef-login-credential" onSubmit={e => { e.preventDefault(); void submit(); }}>
        <p className="ef-login-mobile-hint">{t("SklandLoginPanel.onMobileUseQrSignInCredentialImportRequires")}</p>
        <ol className="ef-credential-steps">
          <li><span>1</span><div><strong>{t("SklandLoginPanel.signInToSklandOnTheWeb")}</strong><p>{t("SklandLoginPanel.open")} <a href="https://www.skland.com/index" target="_blank" rel="noreferrer">www.skland.com/index</a> {t("SklandLoginPanel.andSignIn")}</p></div></li>
          <li><span>2</span><div><strong>{t("SklandLoginPanel.runTheCommandInTheF12Console")}</strong><p>{t("SklandLoginPanel.openTheDeveloperConsoleAndRunThisCommandTo")}</p>
            <div className="ef-credential-command"><code title={copyCommand}>{copyCommand}</code><Action size="sm" icon={copied ? <Check /> : <Clipboard />} onClick={() => {
              void navigator.clipboard.writeText(copyCommand).then(() => {
                if (!mounted.current) return; setCopied(true);
                if (copyTimer.current) clearTimeout(copyTimer.current);
                copyTimer.current = setTimeout(() => setCopied(false), 2000);
              }).catch(() => { if (mounted.current) setError("SklandLoginPanel.copyFailedSelectAndCopyTheCommandManually"); });
            }}>{copied ? t("SklandLoginPanel.copied") : t("SklandLoginPanel.copyCommand")}</Action></div>
          </div></li>
          <li><span>3</span><div><label htmlFor={`${tabs}-credential-input`}><strong>{t("SklandLoginPanel.pasteTheGeneratedCredential")}</strong></label><p>{t("SklandLoginPanel.useCredTokenItIsHeldBrieflyInMemory")}</p><input id={`${tabs}-credential-input`} type="password" placeholder={t("SklandLoginPanel.pasteCredToken")} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={12288} value={credential} onChange={e => setCredential(e.target.value)} /></div></li>
        </ol>
        <div className="ef-credential-risk"><TriangleAlert aria-hidden="true" /><div><strong>{t("SklandLoginPanel.credentialsGrantAccountAccessDoNotShareThem")}</strong><p>{t("SklandLoginPanel.thisPageSyncsEndfieldCharactersOperatorProgressionAndShip")}</p></div></div>
        {policies}
        {error ? <Notice error>{sklandFeedbackText(error, t)}</Notice> : null}
        {!renderDialog ? actions : null}
      </form>}
    </div>
  </div>;
  return renderDialog ? renderDialog(body, actions) : body;
}
