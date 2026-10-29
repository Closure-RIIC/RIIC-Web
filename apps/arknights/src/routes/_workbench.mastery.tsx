import { withMessages } from "@/i18n/features-client";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Pending from "@/app/(workbench)/mastery/loading";
import Page from "@/app/(workbench)/mastery/page";
import { pageHead } from "@/i18n/metadata";
const TranslatedRouteComponent = withMessages(withPageScrollbars(Page), "apps/arknights/src/routes/_workbench.mastery.tsx");

export const Route = createFileRoute("/_workbench/mastery")({
  head: ({ matches }) => pageHead(matches, "mastery"),
  component: TranslatedRouteComponent,
  pendingComponent: Pending,
});
