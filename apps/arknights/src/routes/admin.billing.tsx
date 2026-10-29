import { withMessages } from "@/i18n/features-client";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/admin/billing/page";
import { getAdminAccess } from "@/server/page-data";
const TranslatedRouteComponent = withMessages(withPageScrollbars(Page), "apps/arknights/src/routes/admin.billing.tsx");

export const Route = createFileRoute("/admin/billing")({
  beforeLoad: () => getAdminAccess(),
  component: TranslatedRouteComponent,
});
