import { pageHead } from "@/i18n/metadata";
import { withMessages } from "@/i18n/features-client";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/(workbench)/agent/page";
import { getFeaturePageAccess } from "@/server/page-data";
const TranslatedRouteComponent = withMessages(withPageScrollbars(Page), "apps/arknights/src/routes/_workbench.agent.tsx");

export const Route = createFileRoute("/_workbench/agent")({
  beforeLoad: () => getFeaturePageAccess({ data: "agent" }),
  head: ({ matches }) => pageHead(matches, "agent"),
  component: TranslatedRouteComponent,
});
