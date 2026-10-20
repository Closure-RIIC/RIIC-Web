import type { DocArticle } from "./content.ts";

export function docsPageHead(matches: readonly { routeId: string; loaderData?: unknown }[], article?: Pick<DocArticle, "title" | "description">) {
  const root = matches.find(match => match.routeId === "__root__")?.loaderData as { locale?: string } | undefined;
  const locale = root?.locale ?? "zh";
  const languageIndex = locale === "en" ? 1 : 0;
  const title = article ? `${article.title[languageIndex]} · ${locale === "en" ? "RIIC Docs" : "使用文档"}`
    : locale === "en" ? "Documentation · Closure Infrastructure Terminal" : "使用文档 · 可露希尔基建终端";
  return { meta: [{ title }, ...(article ? [{ name: "description", content: article.description[languageIndex] }] : [])] };
}
