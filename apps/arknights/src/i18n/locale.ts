import { createServerFn } from "@tanstack/react-start";
import { getRequest, setCookie } from "@tanstack/react-start/server";
import { parseLocale, readLocaleCookie } from "@riic/contracts/locale";
import { LOCALE_COOKIE } from "@riic/arknights-domain/i18n/config";
import { loadMessages } from "./messages";
import type { Messages } from "./message-types";
import type { AbstractIntlMessages } from "use-intl";
import { z } from "zod";
import { pageNamespaces } from "./feature-manifest";
export const getRequestI18n = createServerFn({ method: "GET" }).validator(z.object({ pathname: z.string().startsWith("/").max(2048) })).handler(async ({ data }) => {
  const request = getRequest();
  const url = new URL(request.url);
  const selected = parseLocale(url.searchParams.get("ui_locale"));
  const locale = selected ?? readLocaleCookie(request.headers.get("cookie") ?? "", [LOCALE_COOKIE]);
  if (selected) setCookie(LOCALE_COOKIE, selected, { path: "/", maxAge: 31536000, sameSite: "lax", secure: url.protocol === "https:" });
  return { locale, messages: await loadMessages(locale, pageNamespaces(data.pathname)) as AbstractIntlMessages & { Metadata: Messages["Metadata"] } };
});
