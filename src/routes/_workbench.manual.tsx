import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/(workbench)/manual/page";
import { pageHead } from "@/i18n/metadata";
export const Route = createFileRoute("/_workbench/manual")({
  head: ({ matches }) => pageHead(matches, "manual"),
  component: withPageScrollbars(Page),
});
