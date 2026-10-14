import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/help/import-operators/page";
import { pageHead } from "@/i18n/metadata";
export const Route = createFileRoute("/help/import-operators")({
  head: ({ matches }) => pageHead(matches[0].context.messages, "help_import_operators"),
  component: withPageScrollbars(Page),
});
