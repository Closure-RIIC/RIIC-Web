import type { AbstractIntlMessages } from "use-intl";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { LOCALE_COOKIE, resolveLocale } from "./config";

export const getRequestI18n = createServerFn({ method: "GET" }).handler(async () => {
  const locale = resolveLocale(getCookie(LOCALE_COOKIE));
  const messages = locale === "en" ? (await import("../../messages/en")).default : (await import("../../messages/zh")).default;
  return { locale, messages: messages as AbstractIntlMessages & { Metadata: Record<keyof typeof messages.Metadata, string> } };
});
