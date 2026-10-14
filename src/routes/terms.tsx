import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/terms/page";
import { pageHead } from "@/i18n/metadata";
export const Route = createFileRoute("/terms")({
  head: ({ matches }) => pageHead(matches[0].context.messages, "terms"),
  component: withPageScrollbars(Page),
});
