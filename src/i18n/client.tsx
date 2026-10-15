"use client";

import "@/legacy-browser-polyfills";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "@/navigation";
import { IntlProvider, useLocale, useMessages, useTranslations } from "use-intl";
import { isAppLocale, LEGACY_LOCALE_STORAGE, LOCALE_COOKIE, type AppLocale } from "./config";
import { DEFAULT_USER_SETTINGS, loadUserSettings, USER_SETTINGS_CHANGED_EVENT, type UserSettings } from "@/user-settings";

function saveLocale(locale: AppLocale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const sourceMessages = useMessages();
  const messages = sourceMessages;
  const router = useRouter();
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    const cookie = document.cookie.split("; ").find((item) => item.startsWith(`${LOCALE_COOKIE}=`))?.split("=")[1];
    if (isAppLocale(cookie)) return;
    try {
      const legacy = localStorage.getItem(LEGACY_LOCALE_STORAGE);
      if (isAppLocale(legacy)) {
        saveLocale(legacy);
        localStorage.removeItem(LEGACY_LOCALE_STORAGE);
        if (legacy !== locale) router.refresh();
      }
    } catch { /* Storage can be disabled; the server locale remains usable. */ }
  }, [locale, router]);
  return <IntlProvider locale={locale} messages={messages} timeZone="Asia/Shanghai">{children}</IntlProvider>;
}

export function LanguageSwitch() {
  const locale = useLocale();
  const t = useTranslations("Common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [englishEnabled, setEnglishEnabled] = useState(DEFAULT_USER_SETTINGS.loadEnglishResources);
  useEffect(() => {
    const update = () => setEnglishEnabled(loadUserSettings(window.localStorage).loadEnglishResources);
    const onSettingsChange = (event: Event) => setEnglishEnabled((event as CustomEvent<UserSettings>).detail.loadEnglishResources);
    update();
    window.addEventListener(USER_SETTINGS_CHANGED_EVENT, onSettingsChange);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(USER_SETTINGS_CHANGED_EVENT, onSettingsChange);
      window.removeEventListener("storage", update);
    };
  }, []);
  return (
    <div className="relative isolate inline-grid h-7 grid-cols-2 items-center rounded-[4px] border border-border bg-background p-0.5 text-[11px] font-medium" aria-label={t("language")} aria-busy={pending}>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-0.5 top-1/2 h-6 w-[calc((100%-4px)/2)] rounded-[3px] bg-foreground transition-transform duration-240 ease-[var(--motion-ease-out)] motion-reduce:transition-none"
        style={{ transform: `translate(${locale === "en" ? "100%" : "0"}, -50%)` }}
      />
      {(["zh", "en"] as const).map((value) => (
        <button key={value} type="button" disabled={pending || (value === "en" && !englishEnabled)} aria-pressed={locale === value}
          className={`relative z-10 h-6 min-w-9 flex-1 rounded-[3px] px-1.5 transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${locale === value ? "text-background" : "text-muted-foreground hover:text-foreground"}`}
          onClick={() => {
            if (value === locale) return;
            saveLocale(value);
            startTransition(() => router.refresh());
          }}
        >{value === "zh" ? "中文" : englishEnabled ? "EN" : "EN（关闭）"}</button>
      ))}
    </div>
  );
}
