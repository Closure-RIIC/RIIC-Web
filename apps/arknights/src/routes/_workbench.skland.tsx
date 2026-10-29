import { withMessages } from "@/i18n/features-client";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute, notFound } from "@tanstack/react-router";
import Page from "@/app/(workbench)/skland/page";
import { pageHead } from "@/i18n/metadata";
const TranslatedRouteComponent = withMessages(withPageScrollbars(Page), "apps/arknights/src/routes/_workbench.skland.tsx");

export const Route = createFileRoute("/_workbench/skland")({
  beforeLoad: () => { if (process.env.APP_CLIENT_SKLAND_ENABLED !== "1") throw notFound(); },
  head: ({ matches }) => pageHead(matches, "skland"),
  component: TranslatedRouteComponent,
});
