import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/privacy/page";
import { pageHead } from "@/i18n/metadata";
export const Route = createFileRoute("/privacy")({
  head: ({ matches }) => pageHead(matches[0].context.messages, "privacy"),
  component: withPageScrollbars(Page),
});
