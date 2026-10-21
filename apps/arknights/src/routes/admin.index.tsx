import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import { getAdminHealth } from "@/server/page-data";
import { pageHead } from "@/i18n/metadata";
import AdminPage from "@/app/admin/page";
export const Route = createFileRoute("/admin/")({
  loader: () => getAdminHealth(),
  head: ({ matches }) => pageHead(matches, "admin"),
  component: withPageScrollbars(AdminIndex),

});
function AdminIndex() { return <AdminPage {...Route.useLoaderData()} />; }
