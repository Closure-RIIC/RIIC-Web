import { createLocalizer as createUiLocalizer } from "@riic/arknights-domain/i18n/localize";
import type UiMessages from "../../messages/zh-CN/AK_docs_metadata.json";
const uiText = createUiLocalizer<typeof UiMessages>("AK_docs_metadata");
import { docText } from "./content.ts";
import { resolveLocale } from "@riic/contracts/locale";
import type { DocArticle } from "./content.ts";

export function docsPageHead(matches: readonly { routeId: string; loaderData?: unknown }[], article?: Pick<DocArticle, "title" | "description">) {
  const root = matches.find(match => match.routeId === "__root__")?.loaderData as { locale?: string } | undefined;
  const locale = resolveLocale(root?.locale);
  const title = article ? `${docText(article.title, locale)} · ${uiText.text(locale, "riicDocs")}`
    : uiText.text(locale, "documentationClosureInfrastructureTerminal");
  return { meta: [{ title }, ...(article ? [{ name: "description", content: docText(article.description, locale) }] : [])] };
}
