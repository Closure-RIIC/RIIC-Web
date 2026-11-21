import { createFileRoute } from "@tanstack/react-router";
import { withMessages } from "@/i18n/features-client";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { AdminPermissionsPage } from "@/app/admin/permissions/page";
import { getSuperAdminAccess } from "@/server/page-data";

export const Route = createFileRoute("/admin/permissions")({
  beforeLoad: () => getSuperAdminAccess(),
  component: withMessages(withPageScrollbars(AdminPermissionsPage), "apps/arknights/src/routes/admin.permissions.tsx"),
});
