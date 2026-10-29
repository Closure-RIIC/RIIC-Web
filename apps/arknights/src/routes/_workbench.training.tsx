import { withMessages } from "@/i18n/features-client";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Pending from "@/app/(workbench)/training/loading";
import Page from "@/app/(workbench)/training/page";
import { pageHead } from "@/i18n/metadata";
const TranslatedRouteComponent = withMessages(withPageScrollbars(Page), "apps/arknights/src/routes/_workbench.training.tsx");

export const Route = createFileRoute("/_workbench/training")({
  head: ({ matches }) => pageHead(matches, "training"),
  component: TranslatedRouteComponent,
  pendingComponent: Pending,
});
