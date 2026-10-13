"use client";
import { localize as authText } from "../../i18n/helpers/AuthValidation.ts";
import { localize as localize_components_auth_WebsiteAccountPanel } from "../../i18n/helpers/components_auth_WebsiteAccountPanel.ts";
import { useTranslations, useLocale } from "next-intl";
import { messageRecord } from "@/i18n/translate";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  LogOut,
  MailCheck,
  MonitorSmartphone,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";

import {
  WEBSITE_ACCOUNT_NAME_MAX_LENGTH,
  WEBSITE_ACCOUNT_NAME_MIN_LENGTH,
  validateWebsiteAccountName,
} from "@/account-name";
import { accountOrbColor } from "@/account-orb";
import { cloudSyncMetadataKey } from "@/cloud-sync";
import type { CloudSyncStatus } from "@/cloud-sync";
import { passwordConfirmationError } from "@/components/auth/password-confirmation";
import { PasswordInput } from "@/components/auth/password-input";
import { WebsiteAccountLoadingStatus } from "@/components/auth/WebsiteAccountDialogLoading";
import { OtpInput, type OtpInputHandle, type OtpStatus } from "@/components/interior/otp-input";
import { PasswordStrength } from "@/components/interior/password-strength";
import { WizardSteps } from "@/components/interior/wizard-steps";
import {
  InfraTechnicalCard as AccountTechnicalCard,
  InfraTechnicalHeading as AccountTechnicalHeading,
} from "@/components/InfraTechnicalCard";
import { StatusCenterHeader, StatusCenterLoading } from "@/components/pages/StatusCenterShell";
import { SkeletonRouteFallback } from "@/components/ui/skeleton-swap";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SetupActionButton } from "@/components/setup/SetupActionButton";
import { Card, CardContent } from "@/components/ui/card";
import { FluidOrb } from "@/components/ui/fluid-orb";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { PRIVACY_VERSION, TERMS_VERSION } from "@/legal-policy";
import { isStrongPassword } from "@/password-strength";
import { clearLocalProductData } from "@/persistence";
import { CloudDataPanel } from "@/components/cloud/CloudDataPanel";
import type { CloudWorkspaceData, SavedPlanData } from "@/types";
import { useWebsiteSession } from "@/website-session";

type AuthMode = "signin" | "signup" | "forgot";
type AuthStep = "details" | "verify" | "complete";
type AccountAction = "signout" | "sessions" | "delete";

const AUTH_INPUT_CLASS = "border-[#d5d7da] bg-white shadow-none dark:border-[#d5d7da] dark:bg-white dark:text-[#242424] dark:placeholder:text-[#737373]";
const AUTH_PASSWORD_TOGGLE_CLASS = "text-[#737373] hover:text-[#242424] dark:text-[#737373] dark:hover:text-[#242424]";

export interface WebsiteAccountPanelProps {
  onSessionChanged?: (authenticated: boolean) => void | Promise<void>;
  loadingMode?: "page" | "dialog";
  cloudWorkspace?: CloudWorkspaceData | null;
  cloudSyncStatus?: CloudSyncStatus;
  onRestoreSavedPlan?: (plan: SavedPlanData) => void;
  onCloudDataChanged?: () => void;
}

const WEBSITE_ACCOUNT_NAME_HINT_EN = authText.text("en", "nameHint");

function errorMessage(value: unknown, en: boolean): string {
  return value instanceof Error ? value.message : localize_components_auth_WebsiteAccountPanel.text(en, "somethingWentWrongTryAgainLater");
}

function localizedWebsiteAccountName(value: unknown, en: boolean) {
  const result = validateWebsiteAccountName(value);
  return en && result.error ? { ...result, error: WEBSITE_ACCOUNT_NAME_HINT_EN } : result;
}

function localizedPasswordConfirmationError(password: string, confirmation: string, en: boolean): string | null {
  const error = passwordConfirmationError(password, confirmation);
  if (!error || !en) return error;
  return authText.text(en, confirmation ? "passwordMismatch" : "passwordRepeat");
}

function formatSessionExpiry(value: unknown, locale: "zh" | "en"): string | null {
  if (!(value instanceof Date) && typeof value !== "string") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat((locale === "en" ? "en-US" : "zh-CN"), { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function WebsiteAccountPanel({
  onSessionChanged,
  loadingMode = "page",
  cloudWorkspace,
  cloudSyncStatus,
  onRestoreSavedPlan,
  onCloudDataChanged,
}: WebsiteAccountPanelProps) {
  const intl = useTranslations();
  const locale = useLocale();
  const en = locale === "en";
  const modeCopy = messageRecord(en, "components_auth_WebsiteAccountPanel_labels");
  const { data: session, isPending, refetch } = useWebsiteSession();
  const [mode, setMode] = useState<AuthMode>("signin");
  const [step, setStep] = useState<AuthStep>("details");
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordStrengthError, setPasswordStrengthError] = useState<string | null>(null);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmPasswordError, setConfirmPasswordError] = useState<string | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [otp, setOtp] = useState("");
  const [otpStatus, setOtpStatus] = useState<OtpStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<AccountAction | null>(null);
  const [deleteLocalData, setDeleteLocalData] = useState(true);
  const [resendSeconds, setResendSeconds] = useState(0);
  const otpRef = useRef<OtpInputHandle>(null);
  const fieldId = useId();

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setInterval(() => setResendSeconds((current) => Math.max(0, current - 1)), 1_000);
    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  function chooseMode(nextMode: AuthMode) {
    setMode(nextMode);
    setStep("details");
    setPassword("");
    setPasswordStrengthError(null);
    setConfirmPassword("");
    setConfirmPasswordError(null);
    setNameError(null);
    setOtp("");
    setOtpStatus("idle");
    setMessage(null);
    setError(null);
  }

  async function notifySessionChanged(authenticated: boolean) {
    if (onSessionChanged) await onSessionChanged(authenticated);
    else await refetch();
  }

  async function sendVerificationCode() {
    if (!email.trim()) {
      setError(intl("components_auth_WebsiteAccountPanel.enterTheEmailAddressYouWantToVerify"));
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({
        email: email.trim(),
        type: "email-verification",
      });
      if (result.error) throw new Error(result.error.message);
      setStep("verify");
      setOtp("");
      setOtpStatus("idle");
      otpRef.current?.clear();
      setResendSeconds(60);
      setMessage(intl("components_auth_WebsiteAccountPanel.verificationCodeSentCompleteVerificationWithin10Minutes"));
    } catch (caught) {
      setError(errorMessage(caught, en));
    } finally {
      setBusy(false);
    }
  }

  async function submitDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validatedName = mode === "signup" ? localizedWebsiteAccountName(name, en) : null;
    if (validatedName?.error) {
      setNameError(validatedName.error);
      return;
    }
    if (mode === "signup") {
      if (!isStrongPassword(password)) {
        setPasswordStrengthError(authText.text(en, "passwordWeak"));
        return;
      }
      setPasswordStrengthError(null);
      const confirmationError = localizedPasswordConfirmationError(password, confirmPassword, en);
      if (confirmationError) {
        setConfirmPasswordError(confirmationError);
        return;
      }
      setConfirmPasswordError(null);
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (mode === "forgot") {
        const result = await authClient.requestPasswordReset({
          email: email.trim(),
          redirectTo: `${location.origin}/account/reset-password`,
        });
        if (result.error) throw new Error(result.error.message);
        setStep("complete");
        setMessage(intl("components_auth_WebsiteAccountPanel.ifThisEmailIsRegisteredAResetMessageWill"));
      } else if (mode === "signup") {
        const result = await authClient.signUp.email({
          name: validatedName?.name ?? name.trim(),
          email: email.trim(),
          password,
          callbackURL: location.origin,
        });
        if (result.error) throw new Error(result.error.message);
        setStep("verify");
        setResendSeconds(60);
        setMessage(intl("components_auth_WebsiteAccountPanel.verificationCodeSentCompleteVerificationWithin10Minutes"));
      } else {
        const result = await authClient.signIn.email({
          email: email.trim(),
          password,
          callbackURL: location.href,
        });
        if (result.error) throw new Error(result.error.message);
        await notifySessionChanged(true);
      }
    } catch (caught) {
      setError(errorMessage(caught, en));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (otp.length !== 6) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    setOtpStatus("idle");
    try {
      const result = await authClient.emailOtp.verifyEmail({ email: email.trim(), otp });
      if (result.error) throw new Error(result.error.message);
      setOtpStatus("success");
      setStep("complete");
      setMessage(intl("components_auth_WebsiteAccountPanel.emailVerifiedYouCanNowSignIn"));
    } catch (caught) {
      setOtpStatus("error");
      setError(errorMessage(caught, en));
    } finally {
      setBusy(false);
    }
  }

  async function runAccountAction(action: AccountAction) {
    setBusyAction(action);
    setError(null);
    setMessage(null);
    try {
      const result = action === "signout"
        ? await authClient.signOut()
        : action === "sessions"
          ? await authClient.revokeSessions()
          : await authClient.deleteUser({ password: deletePassword, callbackURL: location.origin });
      if (result.error) throw new Error(result.error.message);
      if (action === "delete" && deleteLocalData && session?.user.id) {
        try {
          clearLocalProductData(window.localStorage);
          window.localStorage.removeItem(cloudSyncMetadataKey(session.user.id));
          window.localStorage.removeItem(`cloud-consent-dismissed:${session.user.id}:${TERMS_VERSION}:${PRIVACY_VERSION}`);
        } catch {
          // Account deletion has already succeeded; local storage can still be
          // cleared later from the calculator when browser access is restored.
        }
      }
      setDeletePassword("");
      await notifySessionChanged(false);
    } catch (caught) {
      setError(errorMessage(caught, en));
    } finally {
      setBusyAction(null);
    }
  }

  if (isPending && !busy && !message && !error) {
    return loadingMode === "dialog"
      ? <WebsiteAccountLoadingStatus />
      : <SkeletonRouteFallback><StatusCenterLoading label={intl("components_auth_WebsiteAccountPanel.restoringWebsiteAccount")} /></SkeletonRouteFallback>;
  }

  if (session) {
    const expiresAt = formatSessionExpiry(session.session.expiresAt, locale);
    const orbColor = accountOrbColor(session.user.id);
    return (
      <div className="grid gap-6" data-website-account-panel data-authenticated="true">
        <StatusCenterHeader
          identity={(
            <div className="flex min-w-0 items-center gap-4">
              <FluidOrb
                size={56}
                color={orbColor}
                aria-hidden="true"
                data-website-account-avatar
                data-account-orb-color={orbColor}
              />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-2xl font-semibold tracking-tight">{session.user.name}</h2>
                  <Badge variant="secondary"><ShieldCheck />{intl("components_auth_WebsiteAccountPanel.emailVerified")}</Badge>
                </div>
                <p className="mt-1 break-all text-sm text-muted-foreground">{session.user.email}</p>
              </div>
            </div>
          )}
          actions={(
            <SetupActionButton
              type="button"
              variant="outline"
              className="!min-w-0 max-w-full max-md:!h-auto max-md:min-h-11 max-md:whitespace-normal max-md:!px-3 max-md:py-2"
              disabled={busyAction !== null}
              onClick={() => void runAccountAction("signout")}
              data-account-logout
            >
              <LogOut />{busyAction === "signout" ? (intl("components_auth_WebsiteAccountPanel.signingOut")) : (intl("components_auth_WebsiteAccountPanel.signOutOnThisDevice"))}
            </SetupActionButton>
          )}
        />

        {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
        {message ? <p role="status" className="text-sm text-muted-foreground">{message}</p> : null}

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]" data-account-action-cards>
          <AccountTechnicalCard group="control" className="min-h-64">
            <section className="flex h-full flex-col" aria-labelledby={`${fieldId}-devices`}>
              <AccountTechnicalHeading
                icon={<MonitorSmartphone className="size-4" aria-hidden="true" />}
                titleId={`${fieldId}-devices`}
              >
                {intl("components_auth_WebsiteAccountPanel.signedInDevices")}
              </AccountTechnicalHeading>
              <p className="mt-4 max-w-xl text-sm leading-6 text-white/64">
                {intl("components_auth_WebsiteAccountPanel.thisSessionSigningOutEverywhereRevokesDatabaseSessionsAnd", { value1: (en) ? (expiresAt ? `expires ${expiresAt}` : "is active") : "", value2: (en) ? "" : (expiresAt ? `将在 ${expiresAt} 到期` : "处于有效状态") })}
              </p>
              <div className="mt-auto flex justify-end pt-5">
                <Button
                  type="button"
                  size="dialog"
                  className="bg-white text-[#272a2b] hover:bg-white/90"
                  disabled={busyAction !== null}
                  onClick={() => void runAccountAction("sessions")}
                >
                  {busyAction === "sessions" ? (intl("components_auth_WebsiteAccountPanel.revokingSessions")) : (intl("components_auth_WebsiteAccountPanel.signOutEverywhere"))}
                </Button>
              </div>
            </section>
          </AccountTechnicalCard>

          <AccountTechnicalCard group="manufacture" className="min-h-64">
            <section className="flex h-full flex-col" aria-labelledby={`${fieldId}-delete`}>
              <AccountTechnicalHeading
                icon={<Trash2 className="size-4" aria-hidden="true" />}
                titleId={`${fieldId}-delete`}
              >
                {intl("components_auth_WebsiteAccountPanel.deleteAccountPermanently")}
              </AccountTechnicalHeading>
              <p className="mt-4 text-sm leading-6 text-white/64">
                {intl("components_auth_WebsiteAccountPanel.yourAccountAndAllSessionsWillBeDeletedImmediately")}
              </p>
              <div className="mt-4 grid gap-1.5">
                <Label className="text-white/72" htmlFor={`${fieldId}-delete-password`}>{intl("components_auth_WebsiteAccountPanel.currentPassword")}</Label>
                <PasswordInput
                  id={`${fieldId}-delete-password`}
                  className="border-white/22 bg-white text-[#242424] shadow-none placeholder:text-[#737373]"
                  value={deletePassword}
                  onChange={(event) => setDeletePassword(event.target.value)}
                  minLength={8}
                  maxLength={128}
                  autoComplete="current-password"
                  revealLabel={intl("components_auth_WebsiteAccountPanel.showCurrentPassword")}
                  toggleClassName={AUTH_PASSWORD_TOGGLE_CLASS}
                />
              </div>
              <label className="mt-3 flex min-h-11 items-center gap-3 text-sm text-white/72">
                <input
                  type="checkbox"
                  checked={deleteLocalData}
                  onChange={(event) => setDeleteLocalData(event.target.checked)}
                  className="size-4 shrink-0 accent-white"
                />
                {intl("components_auth_WebsiteAccountPanel.alsoClearThisBrowserSLocalWorkspaceAfterDeletion")}
              </label>
              <div className="mt-auto flex justify-end pt-5">
                <Button
                  type="button"
                  variant="destructive"
                  size="dialog"
                  disabled={deletePassword.length < 8 || busyAction !== null}
                  onClick={() => void runAccountAction("delete")}
                >
                  {busyAction === "delete" ? (intl("components_auth_WebsiteAccountPanel.deleting")) : (intl("components_auth_WebsiteAccountPanel.deleteAccountPermanently"))}
                </Button>
              </div>
            </section>
          </AccountTechnicalCard>
        </div>
        <CloudDataPanel
          userId={session.user.id}
          workspace={cloudWorkspace}
          syncStatus={cloudSyncStatus}
          onRestorePlan={onRestoreSavedPlan}
          onCloudDataChanged={onCloudDataChanged}
        />
      </div>
    );
  }

  const recoverySteps = [
    { id: "details", label: intl("components_auth_WebsiteAccountPanel.confirmEmail") },
    { id: "complete", label: intl("components_auth_WebsiteAccountPanel.checkInbox") },
  ];

  return (
    <Card className="surface-shadow w-full min-w-0 max-w-full overflow-hidden rounded-none ring-0" data-website-account-panel data-auth-wizard>
      <div className="grid min-w-0 lg:grid-cols-[minmax(16rem,0.75fr)_minmax(0,1.25fr)]">
        <div className="min-w-0 border-b border-border/70 px-5 py-6 lg:border-b-0 lg:border-r lg:px-8 lg:py-9">
          <div className="mb-6 grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground">
            <UserRound className="size-5" aria-hidden="true" />
          </div>
          <p className="text-xs font-medium tracking-wide text-primary">{intl("components_auth_WebsiteAccountPanel.account")}</p>
          <h3 className="mt-2 text-2xl font-semibold tracking-tight">{modeCopy[mode].title}</h3>
          <p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">{modeCopy[mode].description}</p>
        </div>

        <CardContent className={mode === "forgot" ? "grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] p-0" : "min-w-0 p-0"}>
          {mode === "forgot" ? (
            <div className="border-b border-border/70 px-5 pb-4 pt-5 sm:px-8 sm:pb-5 sm:pt-7">
              <WizardSteps
                key={mode}
                steps={recoverySteps}
                value={step}
                onValueChange={(value) => {
                  if (value === "details") setStep("details");
                }}
                label={intl("components_auth_WebsiteAccountPanel.passwordRecoverySteps")}
              />
            </div>
          ) : null}
          {step === "details" ? (
            <form onSubmit={submitDetails} className={`grid grid-rows-[1fr_auto] ${mode === "forgot" ? "h-full min-h-0" : "min-h-full"}`}>
              <div className="grid content-start gap-4 px-5 py-6 sm:px-8 sm:py-8">
                {mode === "signup" ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor={`${fieldId}-name`}>{intl("components_auth_WebsiteAccountPanel.displayName")}</Label>
                    <Input
                      id={`${fieldId}-name`}
                      className={AUTH_INPUT_CLASS}
                      value={name}
                      onChange={(event) => {
                        setName(event.target.value);
                        if (nameError) setNameError(localizedWebsiteAccountName(event.target.value, en).error);
                      }}
                      required
                      minLength={WEBSITE_ACCOUNT_NAME_MIN_LENGTH}
                      maxLength={WEBSITE_ACCOUNT_NAME_MAX_LENGTH}
                      placeholder={intl("components_auth_WebsiteAccountPanel.shownOnThisWebsite")}
                      autoComplete="name"
                      aria-invalid={Boolean(nameError)}
                      aria-describedby={`${fieldId}-name-hint`}
                    />
                    <p id={`${fieldId}-name-hint`} role={nameError ? "alert" : undefined} className={`text-xs leading-5 ${nameError ? "text-destructive" : "text-muted-foreground"}`}>
                      {nameError ?? (authText.text(en, "nameHint"))}
                    </p>
                  </div>
                ) : null}
                <div className="grid gap-1.5">
                  <Label htmlFor={`${fieldId}-email`}>{intl("components_auth_WebsiteAccountPanel.email")}</Label>
                  <Input className={AUTH_INPUT_CLASS} id={`${fieldId}-email`} value={email} onChange={(event) => setEmail(event.target.value)} required type="email" placeholder="name@example.com" autoComplete="email" />
                </div>
                {mode !== "forgot" ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor={`${fieldId}-password`}>{intl("components_auth_WebsiteAccountPanel.password")}</Label>
                    <PasswordInput
                      className={AUTH_INPUT_CLASS}
                      id={`${fieldId}-password`}
                      value={password}
                      onChange={(event) => {
                        const nextPassword = event.target.value;
                        setPassword(nextPassword);
                        if (passwordStrengthError) {
                          setPasswordStrengthError(isStrongPassword(nextPassword) ? null : authText.text(en, "passwordWeak"));
                        }
                        if (confirmPasswordError && mode === "signup") {
                          setConfirmPasswordError(localizedPasswordConfirmationError(nextPassword, confirmPassword, en));
                        }
                      }}
                      onBlur={() => {
                        if (mode === "signup" && password && !isStrongPassword(password)) {
                          setPasswordStrengthError(authText.text(en, "passwordWeak"));
                        }
                      }}
                      required
                      minLength={8}
                      maxLength={128}
                      placeholder={intl("components_auth_WebsiteAccountPanel.8128Characters")}
                      autoComplete={mode === "signup" ? "new-password" : "current-password"}
                      revealLabel={intl("components_auth_WebsiteAccountPanel.showPassword")}
                      toggleClassName={AUTH_PASSWORD_TOGGLE_CLASS}
                      aria-invalid={mode === "signup" && Boolean(passwordStrengthError)}
                      aria-describedby={mode === "signup" ? `${fieldId}-password-strength` : undefined}
                    />
                    {mode === "signup" ? (
                      <>
                        <PasswordStrength id={`${fieldId}-password-strength`} value={password} className="mt-1.5" />
                        {passwordStrengthError ? (
                          <p role="alert" className="text-xs leading-5 text-destructive">{passwordStrengthError}</p>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                ) : null}
                {mode === "signup" ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor={`${fieldId}-confirm-password`}>{intl("components_auth_WebsiteAccountPanel.confirmPassword")}</Label>
                    <PasswordInput
                      className={AUTH_INPUT_CLASS}
                      id={`${fieldId}-confirm-password`}
                      value={confirmPassword}
                      onChange={(event) => {
                        const nextConfirmation = event.target.value;
                        setConfirmPassword(nextConfirmation);
                        if (confirmPasswordError) {
                          setConfirmPasswordError(localizedPasswordConfirmationError(password, nextConfirmation, en));
                        }
                      }}
                      onBlur={() => setConfirmPasswordError(localizedPasswordConfirmationError(password, confirmPassword, en))}
                      required
                      minLength={8}
                      maxLength={128}
                      placeholder={intl("components_auth_WebsiteAccountPanel.enterThePasswordAgain")}
                      autoComplete="new-password"
                      revealLabel={intl("components_auth_WebsiteAccountPanel.showPasswordConfirmation")}
                      toggleClassName={AUTH_PASSWORD_TOGGLE_CLASS}
                      aria-invalid={Boolean(confirmPasswordError)}
                      aria-describedby={`${fieldId}-confirm-password-hint`}
                    />
                    <p
                      id={`${fieldId}-confirm-password-hint`}
                      role={confirmPasswordError ? "alert" : undefined}
                      className={`text-xs leading-5 ${confirmPasswordError ? "text-destructive" : "text-muted-foreground"}`}
                    >
                      {confirmPasswordError ?? (intl("components_auth_WebsiteAccountPanel.enterTheSamePasswordAgain"))}
                    </p>
                  </div>
                ) : null}
                {mode === "signup" ? (
                  <p className="text-xs leading-5 text-muted-foreground">
                    {intl.rich("components_auth_WebsiteAccountPanel.rich1", { element1: (chunks) => (<Link className="underline underline-offset-2" href="/terms">{chunks}</Link>), element2: (chunks) => (<Link className="underline underline-offset-2" href="/privacy">{chunks}</Link>) })}
                  </p>
                ) : null}
                {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
                {message ? <p role="status" className="text-sm text-muted-foreground">{message}</p> : null}
              </div>
              <div className="grid gap-3 border-t px-5 py-4 sm:px-8 sm:py-5">
                <Button type="submit" size="dialog" className="w-full" disabled={busy}>
                  {busy ? intl("components_auth_WebsiteAccountPanel.processing") : mode === "signup" ? intl("components_auth_WebsiteAccountPanel.createAccountAndSendCode") : mode === "forgot" ? intl("components_auth_WebsiteAccountPanel.sendResetEmail") : intl("components_auth_WebsiteAccountPanel.signIn")}
                </Button>
                <div className="flex min-h-11 flex-wrap items-center justify-center gap-x-1 text-xs">
                  <Button type="button" size="sm" variant="ghost" onClick={() => chooseMode(mode === "signup" ? "signin" : "signup")}>{mode === "signup" ? intl("components_auth_WebsiteAccountPanel.iHaveAnAccount") : intl("components_auth_WebsiteAccountPanel.createAccount")}</Button>
                  {mode === "forgot" ? (
                    <Button type="button" size="sm" variant="ghost" onClick={() => chooseMode("signin")}><ArrowLeft />{intl("components_auth_WebsiteAccountPanel.backToSignIn")}</Button>
                  ) : (
                    <Button type="button" size="sm" variant="ghost" onClick={() => chooseMode("forgot")}>{intl("components_auth_WebsiteAccountPanel.forgotPassword")}</Button>
                  )}
                  {mode === "signin" ? <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void sendVerificationCode()}>{intl("components_auth_WebsiteAccountPanel.verifyEmail")}</Button> : null}
                </div>
              </div>
            </form>
          ) : step === "verify" ? (
            <form onSubmit={verifyCode} className="grid min-h-full grid-rows-[1fr_auto]">
              <div className="grid content-center gap-5 px-4 py-8 sm:px-8">
                <div className="text-center">
                  <MailCheck className="mx-auto size-8 text-primary" aria-hidden="true" />
                  <h3 className="mt-3 font-semibold">{intl("components_auth_WebsiteAccountPanel.enterEmailVerificationCode")}</h3>
                  <p className="mt-1 break-all text-sm text-muted-foreground">{intl("components_auth_WebsiteAccountPanel.sentTo")} {email}</p>
                </div>
                <OtpInput
                  ref={otpRef}
                  autoFocus
                  disabled={busy}
                  status={otpStatus}
                  onChange={(value) => {
                    setOtp(value);
                    if (otpStatus === "error") {
                      setOtpStatus("idle");
                      setError(null);
                    }
                  }}
                  hint={intl("components_auth_WebsiteAccountPanel.enterThe6DigitCodeFromTheEmail")}
                  errorMessage={error ?? (intl("components_auth_WebsiteAccountPanel.theCodeIsIncorrectOrExpiredTryAgain"))}
                  successMessage={intl("components_auth_WebsiteAccountPanel.verified")}
                />
                {message ? <p role="status" className="text-center text-sm text-muted-foreground">{message}</p> : null}
                {error ? <p role="alert" className="sr-only">{error}</p> : null}
              </div>
              <div className="grid gap-2 border-t px-5 py-4 sm:px-8 sm:py-5">
                <Button type="submit" size="dialog" className="w-full" disabled={busy || otp.length !== 6}>{busy ? (intl("components_auth_WebsiteAccountPanel.verifying")) : (intl("components_auth_WebsiteAccountPanel.verifyEmail"))}</Button>
                <div className="flex min-h-11 items-center justify-center gap-2 text-xs">
                  <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => { setStep("details"); setOtpStatus("idle"); setError(null); }}><ArrowLeft />{intl("components_auth_WebsiteAccountPanel.changeEmail")}</Button>
                  <Button type="button" size="sm" variant="ghost" className="font-number" disabled={busy || resendSeconds > 0} onClick={() => void sendVerificationCode()}>
                    {resendSeconds > 0 ? (intl("components_auth_WebsiteAccountPanel.resendInS", { resendSeconds: resendSeconds })) : (intl("components_auth_WebsiteAccountPanel.resendCode"))}
                  </Button>
                </div>
              </div>
            </form>
          ) : (
            <div className="grid min-h-80 grid-rows-[1fr_auto]">
              <div className="grid content-center justify-items-center gap-3 px-5 py-10 text-center sm:px-8">
                <CheckCircle2 className="size-10 text-emerald-600" aria-hidden="true" />
                <h3 className="font-semibold">{mode === "forgot" ? (intl("components_auth_WebsiteAccountPanel.resetEmailSent")) : (intl("components_auth_WebsiteAccountPanel.emailVerified2"))}</h3>
                {message ? <p role="status" className="max-w-sm text-sm leading-6 text-muted-foreground">{message}</p> : null}
              </div>
              <div className="border-t px-5 py-4 sm:px-8 sm:py-5">
                <Button type="button" size="dialog" className="w-full" onClick={() => chooseMode("signin")}>{intl("components_auth_WebsiteAccountPanel.backToSignIn")}</Button>
              </div>
            </div>
          )}
        </CardContent>
      </div>
    </Card>
  );
}
