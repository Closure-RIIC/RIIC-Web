import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/changelog/page";
import { pageHead } from "@/i18n/metadata";
export const Route = createFileRoute("/changelog")({
  head: ({ matches }) => pageHead(matches[0].context.messages, "changelog"),
  component: withPageScrollbars(Page),
});
