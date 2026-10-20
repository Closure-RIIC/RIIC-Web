import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/admin/agent/page";
import { getAdminAccess } from "@/server/page-data";
export const Route = createFileRoute("/admin/agent")({
  beforeLoad: () => getAdminAccess(),
  component: withPageScrollbars(Page),
});
