import { withMessages } from "@/i18n/features-client";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/admin/agent/page";
import { getAdminAccess } from "@/server/page-data";
const TranslatedRouteComponent = withMessages(withPageScrollbars(Page), "apps/arknights/src/routes/admin.agent.tsx");

export const Route = createFileRoute("/admin/agent")({
  beforeLoad: () => getAdminAccess(),
  component: TranslatedRouteComponent,
});
