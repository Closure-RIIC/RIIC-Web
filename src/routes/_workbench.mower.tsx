import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/(workbench)/mower/page";
import { pageHead } from "@/i18n/metadata";
export const Route = createFileRoute("/_workbench/mower")({
  head: ({ matches }) => pageHead(matches[0].context.messages, "mower"),
  component: withPageScrollbars(Page),
});
