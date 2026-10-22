import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/(workbench)/changelog/page";
import { pageHead } from "@/i18n/metadata";
export const Route = createFileRoute("/_workbench/changelog")({
  head: ({ matches }) => pageHead(matches, "changelog"),
  component: withPageScrollbars(Page),
});
