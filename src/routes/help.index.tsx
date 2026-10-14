import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/help/page";
import { pageHead } from "@/i18n/metadata";
export const Route = createFileRoute("/help/")({
  head: ({ matches }) => pageHead(matches[0].context.messages, "help"),
  component: withPageScrollbars(Page),
});
