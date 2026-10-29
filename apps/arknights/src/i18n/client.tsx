"use client";
import "@/legacy-browser-polyfills";
import { useCallback, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { useTranslations, type AbstractIntlMessages } from "use-intl";
import { APP_LOCALES, LOCALE_LABELS, type AppLocale } from "@riic/contracts/locale";
import { LEGACY_LOCALE_STORAGE, LOCALE_COOKIE } from "@riic/arknights-domain/i18n/config";
import { LanguageProvider, useLanguage } from "@riic/shell/LanguageProvider";
import { loadMessages } from "./messages";
export function LocaleProvider({ locale, messages, children }: { locale: AppLocale; messages: AbstractIntlMessages; children: ReactNode }) {
  const router = useRouter();
  const onLocaleChange = useCallback(() => { void router.invalidate(); }, [router]);
  return <LanguageProvider initialLocale={locale} initialMessages={messages} cookieName={LOCALE_COOKIE} legacyStorage={LEGACY_LOCALE_STORAGE} loadMessages={loadMessages} onLocaleChange={onLocaleChange}>{children}</LanguageProvider>;
}
export function useLanguageSwitch() {
  const language = useLanguage();
  const t = useTranslations("Common");
  return { ...language, label: t("language") };
}
export function LanguageSwitch() {
  const { locale, pending, error, label, setLocale } = useLanguageSwitch();
  const t = useTranslations("AccountMenu");
  return <div role="group" aria-label={label} aria-busy={pending} className="flex flex-wrap gap-1">
    {APP_LOCALES.map(value => <button key={value} type="button" disabled={pending} aria-pressed={locale === value}
      className="rounded border border-border px-2 py-1 text-xs aria-pressed:bg-foreground aria-pressed:text-background"
      onClick={() => void setLocale(value)}>{LOCALE_LABELS[value]}</button>)}
    {error ? <p role="alert" className="w-full text-xs text-destructive">{t("languageFailed")}</p> : null}
  </div>;
}
