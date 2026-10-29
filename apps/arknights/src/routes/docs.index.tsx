import { withMessages } from "@/i18n/features-client";
import { createFileRoute } from "@tanstack/react-router";
import { DocsHome } from "@/components/docs/DocsContent";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { getDocsPageHead } from "@/docs/metadata";

const TranslatedRouteComponent = withMessages(withPageScrollbars(DocsHome), "apps/arknights/src/routes/docs.index.tsx");

export const Route = createFileRoute("/docs/")({
  loader: () => getDocsPageHead({ data: {} }),
  head: ({ loaderData }) => loaderData ?? {},
  component: TranslatedRouteComponent,
});
