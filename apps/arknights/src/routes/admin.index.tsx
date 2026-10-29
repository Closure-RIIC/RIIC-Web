import { withMessages } from "@/i18n/features-client";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import { getAdminHealth } from "@/server/page-data";
import { pageHead } from "@/i18n/metadata";
import AdminPage from "@/app/admin/page";
const TranslatedRouteComponent = withMessages(withPageScrollbars(AdminIndex), "apps/arknights/src/routes/admin.index.tsx");

export const Route = createFileRoute("/admin/")({
  loader: () => getAdminHealth(),
  head: ({ matches }) => pageHead(matches, "admin"),
  component: TranslatedRouteComponent,

});
function AdminIndex() { return <AdminPage {...Route.useLoaderData()} />; }
