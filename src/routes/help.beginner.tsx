import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/help/beginner/page";
import { pageHead } from "@/i18n/metadata";
export const Route = createFileRoute("/help/beginner")({
  head: ({ matches }) => pageHead(matches[0].context.messages, "help"),
  component: withPageScrollbars(Page),
});
