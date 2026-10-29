import { withMessages } from "@/i18n/features-client";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/admin/users/page";
import { pageHead } from "@/i18n/metadata";
import { getAdminAccess } from "@/server/page-data";
const TranslatedRouteComponent = withMessages(withPageScrollbars(Page), "apps/arknights/src/routes/admin.users.tsx");

export const Route = createFileRoute("/admin/users")({
  beforeLoad: () => getAdminAccess(),
  head: ({ matches }) => pageHead(matches, "admin_users"),
  component: TranslatedRouteComponent,
});
