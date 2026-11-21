import { withMessages } from "@/i18n/features-client";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { getReviewerAccess } from "@/server/page-data";
import AdminLayout from "@/app/admin/layout";
const TranslatedRouteComponent = withMessages(AdminShell, "apps/arknights/src/routes/admin.tsx");

export const Route = createFileRoute("/admin")({
  beforeLoad: () => getReviewerAccess(),
  component: TranslatedRouteComponent,
});
function AdminShell() {
  const { isAdmin, isSuperAdmin, name } = Route.useRouteContext();
  return <AdminLayout isAdmin={isAdmin} isSuperAdmin={isSuperAdmin} name={name}><Outlet /></AdminLayout>;
}
