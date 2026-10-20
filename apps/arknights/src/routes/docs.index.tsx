import { createFileRoute } from "@tanstack/react-router";
import { DocsHome } from "@/components/docs/DocsContent";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { docsPageHead } from "@/docs/metadata";

export const Route = createFileRoute("/docs/")({
  head: ({ matches }) => docsPageHead(matches),
  component: withPageScrollbars(DocsHome),
});
