import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute, notFound } from "@tanstack/react-router";
import Page from "@/app/(workbench)/inventory/page";
export const Route = createFileRoute("/_workbench/inventory")({
  beforeLoad: ({ context }) => { if (!context.publicConfig.sklandEnabled) throw notFound(); },
  component: withPageScrollbars(Page),
});
