"use client";

import type { AppLocale } from "@riic/contracts/locale";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "use-intl";
import { CheckCircle2, LoaderCircle, MailCheck } from "lucide-react";
import { WEBSITE_ACCOUNT_NAME_MAX_LENGTH, WEBSITE_ACCOUNT_NAME_MIN_LENGTH, validateWebsiteAccountName } from "@riic/arknights-domain/account-name";
import { isStrongPassword } from "@riic/arknights-domain/password-strength";
import { Button } from "@riic/ui-primitives/button";
import { Input } from "@riic/ui-primitives/input";
import { Label } from "@riic/ui-primitives/label";
import { authClient } from "./client";
import { authText, authFeedbackText, authFlowText, messageRecord } from "./messages";
import { passwordConfirmationError } from "./password-confirmation";
import { PasswordInput } from "./password-input";
import { OtpInput, type OtpInputHandle, type OtpStatus } from "./otp-input";
import { PasswordStrength } from "./password-strength";
import { authFailure, type AuthFailure } from "./auth-feedback";
import { useAuthRequest } from "./use-auth-request";
import styles from "./AuthForm.module.css";
import { AuthAction } from "./AuthAction";
export type AuthMode = "signin" | "signup" | "forgot";
type AuthStep = "details" | "verify" | "complete" | "session";
const AUTH_INPUT_CLASS = "border-border bg-background shadow-none";
const AUTH_PASSWORD_TOGGLE_CLASS = "text-muted-foreground hover:text-foreground";

function localizedWebsiteAccountName(value: unknown, en: AppLocale) {
  const result = validateWebsiteAccountName(value);
  return result.error ? { ...result, error: authText.text(en, "nameHint") } : result;
}

function localizedPasswordConfirmationError(password: string, confirmation: string, en: AppLocale): string | null {
  const error = passwordConfirmationError(password, confirmation);
  if (!error) return null;
  return authText.text(en, confirmation ? "passwordMismatch" : "passwordRepeat");
}


export function WebsiteAuthForm({ onAuthenticated, legalOrigin = "", initialMode = "signin", active = true, hideHeading = false, onTitleChange }: {
  onAuthenticated: () => void | Promise<void>;
  legalOrigin?: string;
  initialMode?: AuthMode;
  active?: boolean;
  hideHeading?: boolean;
  onTitleChange?: (title: string) => void;
}) {
  const intl = useTranslations("Account");
  const locale = useLocale();
  const en = locale;
  const modeCopy = messageRecord(en, "components_auth_WebsiteAccountPanel_labels");
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [step, setStep] = useState<AuthStep>("details");
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordStrengthError, setPasswordStrengthError] = useState<string | null>(null);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmPasswordError, setConfirmPasswordError] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [otpStatus, setOtpStatus] = useState<OtpStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<AuthFailure | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState("");
  const [sessionFailed, setSessionFailed] = useState(false);
  const request = useAuthRequest(active);
  const { busy } = request;
  const [resendSeconds, setResendSeconds] = useState(0);
  const otpRef = useRef<OtpInputHandle>(null);
  const fieldId = useId();

  const title = step === "session" ? authFlowText.text(en, "sessionTitle")
    : step === "verify" ? intl("components_auth_WebsiteAccountPanel.enterEmailVerificationCode")
    : step === "complete" ? intl(mode === "forgot" ? "components_auth_WebsiteAccountPanel.resetEmailSent" : "components_auth_WebsiteAccountPanel.emailVerified2")
    : modeCopy[mode].title;
  useEffect(() => { onTitleChange?.(title); }, [onTitleChange, title]);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setInterval(() => setResendSeconds((current) => Math.max(0, current - 1)), 1_000);
    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  function chooseMode(nextMode: AuthMode) {
    request.invalidate();
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
    setNeedsVerification(false);
    setSessionFailed(false);
  }

  async function sendVerificationCode() {
    const targetEmail = step === "verify" ? verificationEmail : email.trim();
    if (!targetEmail) { setError("invalidEmail"); return; }
    const id = request.begin();
    if (id === null) return;
    setError(null);
    setMessage(null);
    setOtpStatus("idle");
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({
        email: targetEmail,
        type: "email-verification",
      });
      if (!request.isCurrent(id)) return;
      if (result.error) throw result.error;
      setVerificationEmail(targetEmail);
      setStep("verify");
      setOtpStatus("idle");
      setOtp("");
      otpRef.current?.clear();
      setResendSeconds(60);
      setMessage(intl("components_auth_WebsiteAccountPanel.verificationCodeSentCompleteVerificationWithin10Minutes"));
    } catch (caught) {
      if (request.isCurrent(id)) setError(authFailure(caught));
    } finally {
      request.finish(id);
    }
  }

  async function confirmSession(id: number) {
    if (!request.isCurrent(id)) return;
    setStep("session");
    setPassword("");
    setConfirmPassword("");
    setSessionFailed(false);
    try {
      await onAuthenticated();
    } catch {
      if (request.isCurrent(id)) setSessionFailed(true);
    }
  }

  async function retrySession() {
    const id = request.begin();
    if (id === null) return;
    try { await confirmSession(id); } finally { request.finish(id); }
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
    const id = request.begin();
    if (id === null) return;
    setError(null);
    setMessage(null);
    try {
      if (mode === "forgot") {
        const result = await authClient.requestPasswordReset({
          email: email.trim(),
          redirectTo: `${location.origin}/?auth=reset-password`,
        });
        if (!request.isCurrent(id)) return;
        if (result.error && result.error.code !== "USER_NOT_FOUND") throw result.error;
        setStep("complete");
        setMessage(intl("components_auth_WebsiteAccountPanel.ifThisEmailIsRegisteredAResetMessageWill"));
      } else if (mode === "signup") {
        const result = await authClient.signUp.email({
          name: validatedName?.name ?? name.trim(),
          email: email.trim(),
          password,
          callbackURL: location.origin,
        });
        if (!request.isCurrent(id)) return;
        if (result.error) throw result.error;
        setVerificationEmail(email.trim());
        setPassword("");
        setConfirmPassword("");
        setStep("verify");
        setResendSeconds(60);
        setMessage(intl("components_auth_WebsiteAccountPanel.verificationCodeSentCompleteVerificationWithin10Minutes"));
      } else {
        const result = await authClient.signIn.email({
          email: email.trim(),
          password,
          callbackURL: location.href,
        });
        if (!request.isCurrent(id)) return;
        if (result.error) throw result.error;
        await confirmSession(id);
      }
    } catch (caught) {
      if (!request.isCurrent(id)) return;
      const failure = authFailure(caught);
      setError(failure);
      if (failure === "unverifiedEmail") {
        setVerificationEmail(email.trim());
        setNeedsVerification(true);
      }
    } finally {
      request.finish(id);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (otp.length !== 6) return;
    const id = request.begin();
    if (id === null) return;
    setError(null);
    setMessage(null);
    setOtpStatus("idle");
    try {
      const result = await authClient.emailOtp.verifyEmail({ email: verificationEmail, otp });
      if (!request.isCurrent(id)) return;
      if (result.error) throw result.error;
      setOtpStatus("success");
      setStep("complete");
      setMessage(intl("components_auth_WebsiteAccountPanel.emailVerifiedYouCanNowSignIn"));
    } catch (caught) {
      if (!request.isCurrent(id)) return;
      const failure = authFailure(caught);
      setOtpStatus(["invalidCode", "expiredCode", "codeAttempts"].includes(failure) ? "error" : "idle");
      setError(failure);
    } finally {
      request.finish(id);
    }
  }

  return (
    <div className={styles.panel} data-website-account-panel data-auth-wizard data-auth-step={step}>
      <header className={styles.header}>
        {!hideHeading ? <h2 className={styles.title}>{title}</h2> : null}
        {step === "details" ? <p className={styles.description}>{modeCopy[mode].description}</p> : null}
      </header>
          {step === "details" ? (
            <form onSubmit={submitDetails} className={styles.form} aria-busy={busy}>
              <div className={styles.fields} data-yeye-scroll="auto">
                {mode === "signup" ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor={`${fieldId}-name`}>{intl("components_auth_WebsiteAccountPanel.displayName")}</Label>
                    <Input
                      id={`${fieldId}-name`}
                      className={AUTH_INPUT_CLASS}
                      value={name}
                      disabled={busy}
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
                  <Input className={AUTH_INPUT_CLASS} id={`${fieldId}-email`} value={email} disabled={busy} onChange={(event) => { setEmail(event.target.value); setNeedsVerification(false); setError(null); }} required type="email" inputMode="email" autoCapitalize="none" spellCheck={false} placeholder="name@example.com" autoComplete="email" />
                </div>
                {mode !== "forgot" ? (
                  <div className="grid gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor={`${fieldId}-password`}>{intl("components_auth_WebsiteAccountPanel.password")}</Label>
                      {mode === "signin" ? <Button type="button" size="sm" variant="link" onClick={() => chooseMode("forgot")}>{intl("components_auth_WebsiteAccountPanel.forgotPassword")}</Button> : null}
                    </div>
                    <PasswordInput
                      className={AUTH_INPUT_CLASS}
                      id={`${fieldId}-password`}
                      value={password}
                      disabled={busy}
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
                      disabled={busy}
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
                    {intl.rich("components_auth_WebsiteAccountPanel.rich1", { element1: (chunks) => (<a className="underline underline-offset-2" href={`${legalOrigin}/terms`} target="_blank" rel="noopener noreferrer">{chunks}</a>), element2: (chunks) => (<a className="underline underline-offset-2" href={`${legalOrigin}/privacy`} target="_blank" rel="noopener noreferrer">{chunks}</a>) })}
                  </p>
                ) : null}
                {error ? <p role="alert" className={styles.error}>{authFeedbackText.text(en, error)}</p> : null}
                {needsVerification ? <div className={`${styles.notice} ${styles.buttonGroup}`}>
                  <AuthAction type="button" secondary disabled={busy} onClick={() => { setStep("verify"); setError(null); }}>{authFlowText.text(en, "useExistingCode")}</AuthAction>
                  <AuthAction type="button" disabled={busy || resendSeconds > 0} onClick={() => void sendVerificationCode()}>
                    {resendSeconds > 0 ? intl("components_auth_WebsiteAccountPanel.resendInS", { resendSeconds }) : authFlowText.text(en, "sendCode")}
                  </AuthAction>
                </div> : null}
                {error === "existingAccount" ? <div className={styles.buttonGroup}>
                  <AuthAction type="button" secondary onClick={() => chooseMode("forgot")}>{intl("components_auth_WebsiteAccountPanel.forgotPassword")}</AuthAction>
                  <AuthAction type="button" onClick={() => chooseMode("signin")}>{intl("components_auth_WebsiteAccountPanel.signIn")}</AuthAction>
                </div> : null}
                {message ? <p role="status" className="text-sm text-muted-foreground">{message}</p> : null}
              </div>
              <div className={styles.actions} data-auth-actions>
                <AuthAction type="button" secondary onClick={() => chooseMode(mode === "signup" ? "signin" : "signup")}>{mode === "signup" ? intl("components_auth_WebsiteAccountPanel.iHaveAnAccount") : intl("components_auth_WebsiteAccountPanel.createAccount")}</AuthAction>
                {mode === "forgot" ? <AuthAction type="button" secondary onClick={() => chooseMode("signin")}>{intl("components_auth_WebsiteAccountPanel.backToSignIn")}</AuthAction> : null}
                <AuthAction type="submit" disabled={busy}>
                  {busy ? intl("components_auth_WebsiteAccountPanel.processing") : mode === "signup" ? intl("components_auth_WebsiteAccountPanel.createAccountAndSendCode") : mode === "forgot" ? intl("components_auth_WebsiteAccountPanel.sendResetEmail") : intl("components_auth_WebsiteAccountPanel.signIn")}
                </AuthAction>
              </div>
            </form>
          ) : step === "verify" ? (
            <form onSubmit={verifyCode} className={styles.form} aria-busy={busy}>
              <div className={styles.fields} data-yeye-scroll="auto">
                <div className="text-center">
                  <MailCheck className="mx-auto size-8 text-primary" aria-hidden="true" />
                  <p className="mt-2 break-all text-sm text-muted-foreground">{intl("components_auth_WebsiteAccountPanel.sentTo")} {verificationEmail}</p>
                </div>
                <OtpInput
                  ref={otpRef}
                  autoFocus={active}
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
                  errorMessage={error ? authFeedbackText.text(en, error) : intl("components_auth_WebsiteAccountPanel.theCodeIsIncorrectOrExpiredTryAgain")}
                  successMessage={intl("components_auth_WebsiteAccountPanel.verified")}
                />
                {message ? <p role="status" className="text-center text-sm text-muted-foreground">{message}</p> : null}
                {error ? <p role="alert" className={otpStatus === "error" ? "sr-only" : styles.error}>{authFeedbackText.text(en, error)}</p> : null}
                <p className={styles.status}>{authFlowText.text(en, "checkSpam")}</p>
              </div>
              <div className={styles.actions} data-auth-actions>
                <AuthAction type="button" secondary onClick={() => chooseMode("signin")}>{authFlowText.text(en, "changeEmail")}</AuthAction>
                <AuthAction type="button" secondary disabled={busy || resendSeconds > 0} onClick={() => void sendVerificationCode()}>
                    {resendSeconds > 0 ? (intl("components_auth_WebsiteAccountPanel.resendInS", { resendSeconds: resendSeconds })) : (intl("components_auth_WebsiteAccountPanel.resendCode"))}
                </AuthAction>
                <AuthAction type="submit" disabled={busy || otp.length !== 6}>{busy ? (intl("components_auth_WebsiteAccountPanel.verifying")) : (intl("components_auth_WebsiteAccountPanel.verifyEmail"))}</AuthAction>
              </div>
            </form>
          ) : step === "session" ? (
            <div className={styles.form} aria-busy={busy}>
              <div className={`${styles.fields} ${styles.outcome}`} data-yeye-scroll="auto">
                {busy ? <LoaderCircle className="size-7 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
                <p role={sessionFailed ? "alert" : "status"} className={sessionFailed ? styles.error : styles.status}>{authFlowText.text(en, sessionFailed ? "sessionUnavailable" : "sessionChecking")}</p>
              </div>
              {sessionFailed ? <div className={styles.actions} data-auth-actions><AuthAction type="button" disabled={busy} onClick={() => void retrySession()}>{authFlowText.text(en, "retrySession")}</AuthAction></div> : null}
            </div>
          ) : (
            <div className={styles.form}>
              <div className={`${styles.fields} ${styles.outcome}`} data-yeye-scroll="auto">
                <CheckCircle2 className="size-10 text-emerald-600" aria-hidden="true" />
                {message ? <p role="status" className="max-w-sm text-sm leading-6 text-muted-foreground">{message}</p> : null}
                {mode === "forgot" ? <p className={styles.status}>{authFlowText.text(en, "checkSpam")}</p> : null}
              </div>
              <div className={styles.actions} data-auth-actions>
                {mode === "forgot" ? <AuthAction type="button" secondary onClick={() => chooseMode("forgot")}>{authFlowText.text(en, "changeEmail")}</AuthAction> : null}
                <AuthAction type="button" onClick={() => chooseMode("signin")}>{intl("components_auth_WebsiteAccountPanel.backToSignIn")}</AuthAction>
              </div>
            </div>
          )}
    </div>
  );
}
