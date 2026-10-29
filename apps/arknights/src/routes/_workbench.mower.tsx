import { withMessages } from "@/i18n/features-client";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/(workbench)/mower/page";
import { pageHead } from "@/i18n/metadata";
const TranslatedRouteComponent = withMessages(withPageScrollbars(Page), "apps/arknights/src/routes/_workbench.mower.tsx");

export const Route = createFileRoute("/_workbench/mower")({
  head: ({ matches }) => pageHead(matches, "mower"),
  component: TranslatedRouteComponent,
});
