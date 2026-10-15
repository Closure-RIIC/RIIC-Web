import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute, notFound } from "@tanstack/react-router";
import Page from "@/app/(workbench)/gacha/page";
import { pageHead } from "@/i18n/metadata";
export const Route = createFileRoute("/_workbench/gacha")({
  beforeLoad: () => { if (process.env.APP_CLIENT_SKLAND_ENABLED !== "1") throw notFound(); },
  head: ({ matches }) => pageHead(matches, "gacha"),
  component: withPageScrollbars(Page),
});
