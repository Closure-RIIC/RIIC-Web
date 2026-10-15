import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/about/page";
import { pageHead } from "@/i18n/metadata";
export const Route = createFileRoute("/about")({
  head: ({ matches }) => pageHead(matches, "about"),
  component: withPageScrollbars(Page),
});
