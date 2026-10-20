import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Pending from "@/app/(workbench)/mastery/loading";
import Page from "@/app/(workbench)/mastery/page";
import { pageHead } from "@/i18n/metadata";
export const Route = createFileRoute("/_workbench/mastery")({
  head: ({ matches }) => pageHead(matches, "mastery"),
  component: withPageScrollbars(Page),
  pendingComponent: Pending,
});
