import { createFileRoute, Outlet } from "@tanstack/react-router";
import { getReviewerAccess } from "@/server/page-data";
import AdminLayout from "@/app/admin/layout";
export const Route = createFileRoute("/admin")({
  beforeLoad: () => getReviewerAccess(),
  component: AdminShell,
});
function AdminShell() {
  const { isAdmin, name } = Route.useRouteContext();
  return <AdminLayout isAdmin={isAdmin} name={name}><Outlet /></AdminLayout>;
}
