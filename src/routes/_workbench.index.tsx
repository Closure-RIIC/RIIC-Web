import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/(workbench)/page";
import { pageHead } from "@/i18n/metadata";
export const Route = createFileRoute("/_workbench/")({
  head: ({ matches }) => pageHead(matches[0].context.messages, "home"),
  component: withPageScrollbars(Page),
});
