import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/admin/wishes/page";
export const Route = createFileRoute("/admin/wishes")({
  component: withPageScrollbars(Page),
});
