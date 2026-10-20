import { lazy, Suspense, useEffect, useEffectEvent, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ClientOnly } from "@tanstack/react-router";
import { Check, Clipboard, ExternalLink, KeyRound, LoaderCircle, RefreshCw, ScanLine, ShieldCheck, TriangleAlert } from "lucide-react";
import { Action, ActionLink, Notice } from "@shared/endfield-ui";
import type { EndfieldRole } from "@shared/endfield-skland/model";
import { PRIVACY_VERSION, TERMS_VERSION } from "../../../../packages/platform/legal-policy";
import { buildSklandAppOpenUrl } from "../../../../packages/platform/skland-auth-url";
import { nextSklandQrPollDelay } from "../../../../packages/platform/skland-qr-polling";
import { sklandApi, SklandRequestError } from "../skland-client";
import { useWorkspace } from "../state";

const QrCode = lazy(() => import("qrcode.react").then(module => ({ default: module.QRCodeSVG })));
const COPY_COMMAND = "copy(localStorage.getItem('SK_OAUTH_CRED_KEY')+','+localStorage.getItem('SK_TOKEN_CACHE_KEY')),console.log('已复制到粘贴板，回到网页粘贴')";
const consent = () => ({ termsAccepted: true, privacyAccepted: true, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION });
export type EndfieldLogin = { accountId: string; roles: EndfieldRole[] };
type Scan = { scanId: string; scanUrl: string; expiresAt: number };

/** Same layout and interaction pattern as Arknights, with Endfield-only endpoints. */
export function SklandLoginPanel({ main, onAuthenticated, onMethodChange, renderDialog }: {
  main: string; onAuthenticated: (value: EndfieldLogin) => void; onMethodChange: () => void;
  renderDialog?: (body: ReactNode, actions: ReactNode) => ReactNode;
}) {
  const { t } = useWorkspace();
  const [method, setMethod] = useState<"qr" | "credential">("qr");
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [credential, setCredential] = useState("");
  const [scan, setScan] = useState<Scan | null>(null);
  const [scanState, setScanState] = useState<"idle" | "waiting" | "scanned" | "expired">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t("登录失败，请重试。", "Sign-in failed. Please retry."));
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
        setError(cause instanceof Error ? cause.message : "登录查询失败 / Sign-in check failed");
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
    <label><input type="checkbox" checked={terms} onChange={e => updateConsent("terms", e.target.checked)} /><span>{t("我已阅读并同意", "I have read and agree to the ")} <a href={`${main}terms`} target="_blank" rel="noreferrer">{t("本站服务条款", "Terms of service")}</a>。</span></label>
    <label><input type="checkbox" checked={privacy} onChange={e => updateConsent("privacy", e.target.checked)} /><span>{t("我已阅读", "I have read the ")} <a href={`${main}privacy`} target="_blank" rel="noreferrer">{t("本站隐私政策", "Privacy policy")}</a>{t("，并同意本站为登录和数据同步处理我的森空岛凭证、角色、干员与基建数据。", " and consent to processing my Skland credentials, character, operators and ship data for sign-in and sync.")}</span></label>
  </div>;
  const status = busy ? t("正在生成二维码…", "Preparing QR code…") : scanState === "scanned" ? t("已扫码，等待森空岛 App 确认…", "Scanned. Confirm in the Skland app…")
    : scanState === "expired" ? t("二维码已过期，请重新生成。", "QR code expired. Generate a new one.")
      : scan ? t("请使用森空岛 App 扫描二维码", "Scan with the Skland app") : t("勾选下方两项授权后生成二维码", "Accept both policies to generate a QR code");
  const actions = method === "qr"
    ? !scan || error ? <Action size={renderDialog ? "sm" : "default"} variant="yellow" icon={busy ? <LoaderCircle className="ef-spin" /> : <RefreshCw />} aria-busy={busy} disabled={busy || !canSubmit} onClick={() => void submit()}>{scanState === "idle" && !error ? t("生成登录二维码", "Generate login QR code") : t("重新生成二维码", "Generate a new QR code")}</Action> : null
    : <Action size={renderDialog ? "sm" : "default"} variant="yellow" type="submit" form={`${tabs}-credential-form`} icon={busy ? <LoaderCircle className="ef-spin" /> : <KeyRound />} aria-busy={busy} disabled={!canSubmit || !credential.trim() || busy}>{busy ? t("正在验证凭证…", "Verifying credential…") : t("导入并登录", "Import & sign in")}</Action>;
  const body = <div className="ef-login-panel" data-skland-login-panel>
    <div className="ef-login-tabs" role="tablist" aria-label={t("森空岛登录方式", "Skland sign-in method")}>
      {(["qr", "credential"] as const).map(value => <button key={value} id={`${tabs}-${value}`} type="button" role="tab" aria-selected={method === value} aria-controls={`${tabs}-${value}-panel`} tabIndex={method === value ? 0 : -1} onClick={() => changeMethod(value)} onKeyDown={handleKey}>
        {value === "qr" ? <ScanLine /> : <KeyRound />}{value === "qr" ? t("扫码登录", "QR sign-in") : t("凭证导入", "Credential import")}
      </button>)}
    </div>
    <div id={`${tabs}-${method}-panel`} role="tabpanel" aria-labelledby={`${tabs}-${method}`}>
      {method === "qr" ? <div className="ef-login-qr" data-skland-login-qr>
        <div className="ef-login-instructions">
          <p className="ef-login-recommend"><ShieldCheck aria-hidden="true" /><span>{t("推荐方式。打开森空岛 App 扫描二维码，确认后读取终末地角色，同步干员练度与帝江号设施。", "Recommended. Scan with the Skland app to connect your Endfield character and sync operator progression and ship facilities.")}</span></p>
          {policies}
          {error ? <Notice error>{error}</Notice> : null}
          {scan ? <div className="ef-login-app"><ActionLink href={buildSklandAppOpenUrl()} target="_blank" rel="noreferrer" icon={<ExternalLink />}>{t("打开森空岛 App", "Open Skland app")}</ActionLink><p>{t("请用森空岛扫描二维码；必要时可在另一台设备展示。", "Scan with Skland; display this code on another device if needed.")}</p></div> : null}
          {!renderDialog ? actions : null}
        </div>
        <div className="ef-login-visual">
          <div className="ef-qr-frame" data-skland-qr-visual>
            {scanState === "scanned" || busy ? <LoaderCircle className="ef-spin" aria-hidden="true" /> : scan ? <ClientOnly><Suspense fallback={<LoaderCircle className="ef-spin" />}><QrCode value={scan.scanUrl} size={196} bgColor="#fff" fgColor="#000" title={t("森空岛登录二维码", "Skland login QR code")} role="img" aria-label={t("森空岛登录二维码", "Skland login QR code")} /></Suspense></ClientOnly> : <ScanLine aria-hidden="true" />}
          </div>
          <p role="status" aria-live="polite">{status}</p>
        </div>
      </div> : <form id={`${tabs}-credential-form`} className="ef-login-credential" onSubmit={e => { e.preventDefault(); void submit(); }}>
        <p className="ef-login-mobile-hint">{t("手机端优先使用扫码；凭证导入需要桌面浏览器的开发者工具。", "On mobile, use QR sign-in. Credential import requires desktop developer tools.")}</p>
        <ol className="ef-credential-steps">
          <li><span>1</span><div><strong>{t("登录森空岛网页版", "Sign in to Skland on the web")}</strong><p>{t("打开", "Open ")} <a href="https://www.skland.com/index" target="_blank" rel="noreferrer">www.skland.com/index</a> {t("并完成登录。", "and sign in.")}</p></div></li>
          <li><span>2</span><div><strong>{t("在 F12 Console 执行命令", "Run the command in the F12 Console")}</strong><p>{t("打开开发者工具的 Console，将下方命令粘贴并执行。它只读取森空岛页面已有的 cred 与 token，并复制为一行。", "Open the developer Console and run this command to copy your existing Skland cred and token as one line.")}</p>
            <div className="ef-credential-command"><code title={COPY_COMMAND}>{COPY_COMMAND}</code><Action size="sm" icon={copied ? <Check /> : <Clipboard />} onClick={() => {
              void navigator.clipboard.writeText(COPY_COMMAND).then(() => {
                if (!mounted.current) return; setCopied(true);
                if (copyTimer.current) clearTimeout(copyTimer.current);
                copyTimer.current = setTimeout(() => setCopied(false), 2000);
              }).catch(() => { if (mounted.current) setError(t("复制失败，请手动选择命令复制。", "Copy failed. Select and copy the command manually.")); });
            }}>{copied ? t("已复制", "Copied") : t("复制命令", "Copy command")}</Action></div>
          </div></li>
          <li><span>3</span><div><label htmlFor={`${tabs}-credential-input`}><strong>{t("粘贴生成的单行凭证", "Paste the generated credential")}</strong></label><p>{t("内容应为 cred,token，仅在本次请求和当前组件内存中短暂存在。", "Use cred,token. It is held briefly in memory and sent only for this sign-in request.")}</p><input id={`${tabs}-credential-input`} type="password" placeholder={t("粘贴 cred,token", "Paste cred,token")} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={12288} value={credential} onChange={e => setCredential(e.target.value)} /></div></li>
        </ol>
        <div className="ef-credential-risk"><TriangleAlert aria-hidden="true" /><div><strong>{t("凭证等同登录权限，请勿发送给任何人", "Credentials grant account access. Do not share them.")}</strong><p>{t("本站仅同步终末地角色、干员练度与帝江号设施；凭证不会写入本地名单或导出文件。", "This page syncs Endfield characters, operator progression and ship facilities. Credentials are excluded from local rosters and exports.")}</p></div></div>
        {policies}
        {error ? <Notice error>{error}</Notice> : null}
        {!renderDialog ? actions : null}
      </form>}
    </div>
  </div>;
  return renderDialog ? renderDialog(body, actions) : body;
}
