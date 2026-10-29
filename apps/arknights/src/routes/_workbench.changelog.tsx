import { withMessages } from "@/i18n/features-client";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/(workbench)/changelog/page";
import { pageHead } from "@/i18n/metadata";
const TranslatedRouteComponent = withMessages(withPageScrollbars(Page), "apps/arknights/src/routes/_workbench.changelog.tsx");

export const Route = createFileRoute("/_workbench/changelog")({
  head: ({ matches }) => pageHead(matches, "changelog"),
  component: TranslatedRouteComponent,
});
