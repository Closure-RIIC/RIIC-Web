import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Pending from "@/app/(workbench)/training-plan/loading";
import Page from "@/app/(workbench)/training-plan/page";
import { pageHead } from "@/i18n/metadata";

export const Route = createFileRoute("/_workbench/training-plan")({
  head: ({ matches }) => pageHead(matches, "trainingPlanner"),
  component: withPageScrollbars(Page),
  pendingComponent: Pending,
});
