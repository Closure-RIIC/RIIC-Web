import { createFileRoute, notFound } from "@tanstack/react-router";
import { DocsArticlePage, DocsMissingArticle } from "@/components/docs/DocsContent";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { docsPageHead } from "@/docs/metadata";

export const Route = createFileRoute("/docs/$slug")({
  validateSearch: (search: Record<string, unknown>): { source?: "maa" | "skland" } => ({ source: search.source === "maa" || search.source === "skland" ? search.source : undefined }),
  loader: async ({ params }) => {
    const { findDoc } = await import("@/docs/content");
    const article = findDoc(params.slug);
    if (!article) throw notFound();
    return { title: article.title, description: article.description };
  },
  head: ({ matches, loaderData }) => docsPageHead(matches, loaderData),
  component: withPageScrollbars(DocsArticlePage),
  notFoundComponent: DocsMissingArticle,
});
