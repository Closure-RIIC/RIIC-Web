import { withMessages } from "@/i18n/features-client";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute, notFound } from "@tanstack/react-router";
import Page from "@/app/(workbench)/inventory/page";
const TranslatedRouteComponent = withMessages(withPageScrollbars(Page), "apps/arknights/src/routes/_workbench.inventory.tsx");

export const Route = createFileRoute("/_workbench/inventory")({
  beforeLoad: () => { if (process.env.APP_CLIENT_SKLAND_ENABLED !== "1") throw notFound(); },
  component: TranslatedRouteComponent,
});
