import { pageHead } from "@/i18n/metadata";
import { withMessages } from "@/i18n/features-client";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/(workbench)/billing/page";
import { getFeaturePageAccess } from "@/server/page-data";
const TranslatedRouteComponent = withMessages(withPageScrollbars(Page), "apps/arknights/src/routes/_workbench.billing.tsx");

export const Route = createFileRoute("/_workbench/billing")({
  beforeLoad: () => getFeaturePageAccess({ data: "billing" }),
  head: ({ matches }) => pageHead(matches, "billing"),
  component: TranslatedRouteComponent,
});
