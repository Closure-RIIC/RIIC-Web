import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute, notFound } from "@tanstack/react-router";
import Page from "@/app/(workbench)/inventory/page";
export const Route = createFileRoute("/_workbench/inventory")({
  beforeLoad: () => { if (process.env.APP_CLIENT_SKLAND_ENABLED !== "1") throw notFound(); },
  component: withPageScrollbars(Page),
});
