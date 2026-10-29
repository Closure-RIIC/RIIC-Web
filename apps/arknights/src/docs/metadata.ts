import { createLocalizer as createUiLocalizer } from "@riic/arknights-domain/i18n/localize";
import type UiMessages from "../../messages/zh-CN/AK_docs_metadata.json";
const uiText = createUiLocalizer<typeof UiMessages>("AK_docs_metadata");
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { docText, findDoc } from "./content.ts";
import { getRequestI18n } from "../i18n/locale";

// Route head runs before React registers hydrated catalogs. Return translated
// metadata from the loader so redirects and client navigation have it immediately.
export const getDocsPageHead = createServerFn({ method: "GET" }).validator(z.object({ slug: z.string().max(100).optional() })).handler(async ({ data }) => {
  const article = data.slug ? findDoc(data.slug) : undefined;
  if (data.slug && !article) return null;
  const { locale } = await getRequestI18n({ data: { pathname: data.slug ? `/docs/${data.slug}` : "/docs" } });
  const title = article ? `${docText(article.title, locale)} · ${uiText.text(locale, "riicDocs")}`
    : uiText.text(locale, "documentationClosureInfrastructureTerminal");
  return { meta: [{ title }, ...(article ? [{ name: "description", content: docText(article.description, locale) }] : [])] };
});
