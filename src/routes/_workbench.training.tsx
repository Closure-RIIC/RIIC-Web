import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Pending from "@/app/(workbench)/training/loading";
import Page from "@/app/(workbench)/training/page";
import { pageHead } from "@/i18n/metadata";
export const Route = createFileRoute("/_workbench/training")({
  head: ({ matches }) => pageHead(matches[0].context.messages, "training"),
  component: withPageScrollbars(Page),
  pendingComponent: Pending,
});
