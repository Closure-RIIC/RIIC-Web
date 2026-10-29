import { withMessages } from "@/i18n/features-client";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { DocsArticlePage, DocsMissingArticle } from "@/components/docs/DocsContent";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { getDocsPageHead } from "@/docs/metadata";

const TranslatedRouteComponent = withMessages(withPageScrollbars(DocsArticlePage), "apps/arknights/src/routes/docs.$slug.tsx");

export const Route = createFileRoute("/docs/$slug")({
  validateSearch: (search: Record<string, unknown>): { source?: "maa" | "skland" } => ({ source: search.source === "maa" || search.source === "skland" ? search.source : undefined }),
  loader: async ({ params }) => {
    const metadata = await getDocsPageHead({ data: { slug: params.slug } });
    if (!metadata) throw notFound();
    return metadata;
  },
  head: ({ loaderData }) => loaderData ?? {},
  component: TranslatedRouteComponent,
  notFoundComponent: DocsMissingArticle,
});
