import { withMessages } from "@/i18n/features-client";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/(workbench)/account-health/page";
import { pageHead } from "@/i18n/metadata";
const TranslatedRouteComponent = withMessages(withPageScrollbars(Page), "apps/arknights/src/routes/_workbench.account-health.tsx");

export const Route = createFileRoute("/_workbench/account-health")({
  head: ({ matches }) => pageHead(matches, "account_health"),
  component: TranslatedRouteComponent,
});
