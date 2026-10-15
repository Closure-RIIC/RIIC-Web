"use client";
import { localize as authText } from "../../../i18n/helpers/AuthValidation.ts";
import { useTranslations, useLocale } from "use-intl";
import { messageRecord } from "@/i18n/translate";

import { useEffect, useMemo, useState } from "react";

import { passwordConfirmationError } from "@/components/auth/password-confirmation";
import { PasswordInput } from "@/components/auth/password-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { evaluatePasswordStrength, isStrongPassword } from "@/password-strength";
import { LanguageSwitch } from "@/i18n/client";

function ResetPasswordStrength({ value, id }: { value: string; id: string }) {
  const intl = useTranslations();
  const locale = useLocale();
  const en = locale === "en";
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

export function ResetPassword() {
  const intl = useTranslations();
  const locale = useLocale();
  const en = locale === "en";
  const [password, setPassword] = useState("");
  const [passwordStrengthError, setPasswordStrengthError] = useState<string | null>(null);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmPasswordError, setConfirmPasswordError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const resetToken = new URLSearchParams(location.search).get("token")?.trim() ?? "";
    setToken(resetToken);
    if (!resetToken) setMessage(intl("app_account_reset_password_reset_client.theResetLinkIsInvalidOrMissingAToken"));
  }, [intl, en]);

  async function resetPassword() {
    if (!token) {
      setMessage(intl("app_account_reset_password_reset_client.theResetLinkIsInvalidOrMissingAToken"));
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
    setBusy(true);
    setMessage(null);
    const result = await authClient.resetPassword({ newPassword: password, token });
    setMessage(result.error?.message ?? (intl("app_account_reset_password_reset_client.passwordResetExistingSessionsHaveBeenRevokedReturnTo")));
    setBusy(false);
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-content-center gap-4 p-5">
      <div className="flex items-center justify-between gap-4"><a href="/" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">{intl("app_account_reset_password_reset_client.backToScheduler")}</a><LanguageSwitch /></div>
      <h1 className="text-2xl font-semibold">{intl("app_account_reset_password_reset_client.resetPassword")}</h1>
      <p className="text-sm leading-6 text-muted-foreground">{intl("app_account_reset_password_reset_client.theNewPasswordMustContain8128CharactersAnd")}</p>
      <div className="grid gap-1.5">
        <Label htmlFor="reset-password">{intl("app_account_reset_password_reset_client.newPassword")}</Label>
        <PasswordInput
          id="reset-password"
          minLength={8}
          maxLength={128}
          value={password}
          onChange={(event) => {
            const nextPassword = event.target.value;
            setPassword(nextPassword);
            if (passwordStrengthError) {
              setPasswordStrengthError(isStrongPassword(nextPassword) ? null : (authText.text(en, "passwordWeak")));
            }
            if (confirmPasswordError) {
              const error = passwordConfirmationError(nextPassword, confirmPassword);
              setConfirmPasswordError(en && error ? (confirmPassword ? "The passwords do not match." : "Enter the password again.") : error);
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
          onChange={(event) => {
            const nextConfirmation = event.target.value;
            setConfirmPassword(nextConfirmation);
            if (confirmPasswordError) {
              const error = passwordConfirmationError(password, nextConfirmation);
              setConfirmPasswordError(en && error ? (nextConfirmation ? "The passwords do not match." : "Enter the password again.") : error);
            }
          }}
          onBlur={() => {
            const error = passwordConfirmationError(password, confirmPassword);
            setConfirmPasswordError(en && error ? (confirmPassword ? "The passwords do not match." : "Enter the password again.") : error);
          }}
          autoComplete="new-password"
          placeholder={intl("app_account_reset_password_reset_client.enterTheNewPasswordAgain")}
          revealLabel={intl("app_account_reset_password_reset_client.showPasswordConfirmation")}
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
      <Button
        type="button"
        disabled={busy || !token || password.length < 8 || confirmPassword.length < 8}
        onClick={() => void resetPassword()}
      >
        {busy ? (intl("app_account_reset_password_reset_client.resetting")) : (intl("app_account_reset_password_reset_client.resetPassword2"))}
      </Button>
      {message ? <p role="status" className="text-sm text-muted-foreground">{message}</p> : null}
    </main>
  );
}
