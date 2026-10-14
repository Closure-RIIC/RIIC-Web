import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/(workbench)/settings/page";
import { pageHead } from "@/i18n/metadata";
export const Route = createFileRoute("/_workbench/settings")({
  head: ({ matches }) => pageHead(matches[0].context.messages, "settings"),
  component: withPageScrollbars(Page),
});
