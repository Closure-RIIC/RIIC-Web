import { createServerFn } from "@tanstack/react-start";
import { getRequest, setCookie } from "@tanstack/react-start/server";
import { parseLocale } from "@riic/contracts/locale";
import { ENDFIELD_LOCALE_COOKIE, readEndfieldLocale } from "../local-settings";
import { loadMessages } from "./messages";
import { z } from "zod";
import { pageNamespaces } from "./feature-manifest";

export const getRequestI18n = createServerFn({ method: "GET" }).validator(z.object({ pathname: z.string().startsWith("/").max(2048) })).handler(async ({ data }) => {
  const request = getRequest();
  const selected = parseLocale(new URL(request.url).searchParams.get("ui_locale"));
  const locale = selected ?? readEndfieldLocale(request.headers.get("cookie") ?? "");
  if (selected) setCookie(ENDFIELD_LOCALE_COOKIE, selected, { path: "/", maxAge: 31536000, sameSite: "lax", secure: new URL(request.url).protocol === "https:" });
  return { locale, messages: await loadMessages(locale, pageNamespaces(data.pathname)) };
});
