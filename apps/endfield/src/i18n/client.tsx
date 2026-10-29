import { useCallback, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { useTranslations, type AbstractIntlMessages } from "use-intl";
import type { AppLocale } from "@riic/contracts/locale";
import { LanguageProvider, useLanguage } from "@riic/shell/LanguageProvider";
import { ENDFIELD_LOCALE_COOKIE } from "../local-settings";
import { loadMessages } from "./messages";
export function EndfieldLanguageProvider({ initialLocale, initialMessages, children }: { initialLocale: AppLocale; initialMessages: AbstractIntlMessages; children: ReactNode }) {
  const router = useRouter();
  const onLocaleChange = useCallback(() => { void router.invalidate(); }, [router]);
  return <LanguageProvider initialLocale={initialLocale} initialMessages={initialMessages} cookieName={ENDFIELD_LOCALE_COOKIE} loadMessages={loadMessages} onLocaleChange={onLocaleChange}>{children}</LanguageProvider>;
}
export function useEndfieldLanguage() { return { ...useLanguage(), t: useTranslations() }; }
