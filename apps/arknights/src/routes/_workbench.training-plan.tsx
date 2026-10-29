import { withMessages } from "@/i18n/features-client";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Pending from "@/app/(workbench)/training-plan/loading";
import Page from "@/app/(workbench)/training-plan/page";
import { pageHead } from "@/i18n/metadata";

const TranslatedRouteComponent = withMessages(withPageScrollbars(Page), "apps/arknights/src/routes/_workbench.training-plan.tsx");

export const Route = createFileRoute("/_workbench/training-plan")({
  head: ({ matches }) => pageHead(matches, "trainingPlanner"),
  component: TranslatedRouteComponent,
  pendingComponent: Pending,
});
