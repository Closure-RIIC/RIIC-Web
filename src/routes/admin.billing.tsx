import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/admin/billing/page";
import { getAdminAccess } from "@/server/page-data";
export const Route = createFileRoute("/admin/billing")({
  beforeLoad: () => getAdminAccess(),
  component: withPageScrollbars(Page),
});
