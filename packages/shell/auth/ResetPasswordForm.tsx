"use client";
import { authText, authFeedbackText, authFlowText, messageRecord } from "./messages";
import { useTranslations, useLocale } from "use-intl";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";
import { authFailure, type AuthFailure } from "./auth-feedback";
import { useAuthRequest } from "./use-auth-request";
import styles from "./AuthForm.module.css";
import { AuthAction } from "./AuthAction";

import { passwordConfirmationError } from "./password-confirmation";
import { PasswordInput } from "./password-input";
import { Label } from "@riic/ui-primitives/label";
import { authClient } from "./client";
import { evaluatePasswordStrength, isStrongPassword } from "@riic/arknights-domain/password-strength";

function ResetPasswordStrength({ value, id }: { value: string; id: string }) {
  const intl = useTranslations("Account");
  const locale = useLocale();
  const en = locale;
  const strength = useMemo(() => evaluatePasswordStrength(value), [value]);
  const labels = messageRecord(en, "app_account_reset_password_reset_client_labels");
  const tone = strength.score === 0
    ? "bg-muted-foreground/25"
    : strength.score <= 1
      ? "bg-destructive"
      : strength.score <= 2
        ? "bg-amber-500"
        : "bg-emerald-500";

  return (
    <div id={id} className="mt-1.5 w-full" data-password-strength>
      <div
        role="meter"
        aria-label={intl("app_account_reset_password_reset_client.passwordStrength")}
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={strength.score}
        aria-valuetext={labels[strength.score]}
        className="grid grid-cols-4 gap-1.5"
      >
        {strength.rules.map((rule, index) => (
          <span key={rule.id} className={`h-1.5 rounded-sm ${index < strength.score ? tone : "bg-muted"}`} />
        ))}
      </div>
      <p aria-live="polite" className="mt-2 text-xs text-muted-foreground">
        {intl("app_account_reset_password_reset_client.passwordStrength2", { value1: labels[strength.score] })}{strength.guessable ? (intl("app_account_reset_password_reset_client.avoidCommonEasyToGuessPatterns")) : ""}
      </p>
      <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        {strength.rules.map((rule) => (
          <li key={rule.id} className={`text-xs ${rule.met ? "text-foreground" : "text-muted-foreground"}`}>
            {rule.met ? "✓" : "○"} {authText.text(en, rule.id)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ResetPasswordForm({ token, onSignIn, onForgotPassword, active = true, hideHeading = false, onTitleChange }: {
  token: string;
  onSignIn: () => void;
  onForgotPassword: () => void;
  active?: boolean;
  hideHeading?: boolean;
  onTitleChange?: (title: string) => void;
}) {
  const intl = useTranslations("Account");
  const locale = useLocale();
  const en = locale;
  const [password, setPassword] = useState("");
  const [passwordStrengthError, setPasswordStrengthError] = useState<string | null>(null);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmPasswordError, setConfirmPasswordError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<AuthFailure | null>(token ? null : "expiredReset");
  const request = useAuthRequest(active);
  const { busy } = request;
  const title = success ? authFlowText.text(en, "resetComplete") : intl("app_account_reset_password_reset_client.resetPassword");
  useEffect(() => { onTitleChange?.(title); }, [onTitleChange, title]);

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (success) return;
    if (!token) {
      setError("expiredReset");
      return;
    }
    if (!isStrongPassword(password)) {
      setPasswordStrengthError(authText.text(en, "passwordWeak"));
      return;
    }
    setPasswordStrengthError(null);
    const confirmationError = passwordConfirmationError(password, confirmPassword);
    if (confirmationError) {
      setConfirmPasswordError(authText.text(en, confirmPassword ? "passwordMismatch" : "passwordRepeat"));
      return;
    }
    setConfirmPasswordError(null);
    const id = request.begin();
    if (id === null) return;
    setError(null);
    try {
      const result = await authClient.resetPassword({ newPassword: password, token });
      if (!request.isCurrent(id)) return;
      if (result.error) throw result.error;
      setPassword("");
      setConfirmPassword("");
      setSuccess(true);
    } catch (caught) {
      if (request.isCurrent(id)) setError(authFailure(caught));
    } finally { request.finish(id); }
  }

  if (success || error === "expiredReset") return (
    <div className={styles.panel} data-password-reset-form>
      {!hideHeading ? <header className={styles.header}><h2 className={styles.title}>{title}</h2></header> : null}
      <div className={`${styles.fields} ${styles.outcome}`} data-yeye-scroll="auto">
        {success ? <CheckCircle2 className="size-8 text-emerald-600" aria-hidden="true" /> : null}
        <p role={success ? "status" : "alert"} className={success ? styles.status : styles.error}>
          {success ? intl("app_account_reset_password_reset_client.passwordResetExistingSessionsHaveBeenRevokedReturnTo") : authFeedbackText.text(en, "expiredReset")}
        </p>
      </div>
      <div className={styles.actions} data-auth-actions>
        {!success ? <AuthAction type="button" secondary onClick={onSignIn}>{intl("components_auth_WebsiteAccountPanel.backToSignIn")}</AuthAction> : null}
        <AuthAction type="button" onClick={success ? onSignIn : onForgotPassword}>{authFlowText.text(en, success ? "signInWithNewPassword" : "requestNewReset")}</AuthAction>
      </div>
    </div>
  );

  return (
    <form className={styles.panel} data-password-reset-form onSubmit={resetPassword} aria-busy={busy}>
      <header className={styles.header}>
        {!hideHeading ? <h2 className={styles.title}>{title}</h2> : null}
        <p className={styles.description}>{intl("app_account_reset_password_reset_client.theNewPasswordMustContain8128CharactersAnd")}</p>
      </header>
      <div className={styles.fields} data-yeye-scroll="auto">
      <div className="grid gap-1.5">
        <Label htmlFor="reset-password">{intl("app_account_reset_password_reset_client.newPassword")}</Label>
        <PasswordInput
          id="reset-password"
          minLength={8}
          maxLength={128}
          value={password}
          disabled={busy}
          required
          onChange={(event) => {
            const nextPassword = event.target.value;
            setPassword(nextPassword);
            if (passwordStrengthError) {
              setPasswordStrengthError(isStrongPassword(nextPassword) ? null : (authText.text(en, "passwordWeak")));
            }
            if (confirmPasswordError) {
              const error = passwordConfirmationError(nextPassword, confirmPassword);
              setConfirmPasswordError(error ? authText.text(en, confirmPassword ? "passwordMismatch" : "passwordRepeat") : null);
            }
          }}
          onBlur={() => {
            if (password && !isStrongPassword(password)) {
              setPasswordStrengthError(authText.text(en, "passwordWeak"));
            }
          }}
          autoComplete="new-password"
          placeholder={intl("app_account_reset_password_reset_client.newPassword8128Characters")}
          revealLabel={intl("app_account_reset_password_reset_client.showNewPassword")}
          hideLabel={intl("app_account_reset_password_reset_client.hideNewPassword")}
          aria-invalid={Boolean(passwordStrengthError)}
          aria-describedby="reset-password-strength"
        />
        <ResetPasswordStrength id="reset-password-strength" value={password} />
        {passwordStrengthError ? (
          <p role="alert" className="text-xs leading-5 text-destructive">{passwordStrengthError}</p>
        ) : null}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="reset-confirm-password">{intl("app_account_reset_password_reset_client.confirmNewPassword")}</Label>
        <PasswordInput
          id="reset-confirm-password"
          minLength={8}
          maxLength={128}
          value={confirmPassword}
          disabled={busy}
          required
          onChange={(event) => {
            const nextConfirmation = event.target.value;
            setConfirmPassword(nextConfirmation);
            if (confirmPasswordError) {
              const error = passwordConfirmationError(password, nextConfirmation);
              setConfirmPasswordError(error ? authText.text(en, nextConfirmation ? "passwordMismatch" : "passwordRepeat") : null);
            }
          }}
          onBlur={() => {
            const error = passwordConfirmationError(password, confirmPassword);
            setConfirmPasswordError(error ? authText.text(en, confirmPassword ? "passwordMismatch" : "passwordRepeat") : null);
          }}
          autoComplete="new-password"
          placeholder={intl("app_account_reset_password_reset_client.enterTheNewPasswordAgain")}
          revealLabel={intl("app_account_reset_password_reset_client.showPasswordConfirmation")}
          hideLabel={intl("app_account_reset_password_reset_client.hidePasswordConfirmation")}
          aria-invalid={Boolean(confirmPasswordError)}
          aria-describedby="reset-confirm-password-hint"
        />
        <p
          id="reset-confirm-password-hint"
          role={confirmPasswordError ? "alert" : undefined}
          className={`text-xs leading-5 ${confirmPasswordError ? "text-destructive" : "text-muted-foreground"}`}
        >
          {confirmPasswordError ?? (intl("app_account_reset_password_reset_client.enterTheNewPasswordAgain2"))}
        </p>
      </div>
      {error ? <p role="alert" className={styles.error}>{authFeedbackText.text(en, error)}</p> : null}
      </div>
      <div className={styles.actions} data-auth-actions>
      <AuthAction type="button" secondary onClick={onSignIn}>{intl("components_auth_WebsiteAccountPanel.backToSignIn")}</AuthAction>
      <AuthAction
        type="submit"
        disabled={busy || !token || password.length < 8 || confirmPassword.length < 8}
      >
        {busy ? (intl("app_account_reset_password_reset_client.resetting")) : (intl("app_account_reset_password_reset_client.resetPassword2"))}
      </AuthAction>
      </div>
    </form>
  );
}
