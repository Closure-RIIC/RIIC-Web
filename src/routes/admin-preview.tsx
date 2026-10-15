import { createFileRoute, Outlet } from "@tanstack/react-router";
import { getAdminPreviewAccess } from "@/server/page-data";
import { AdminPreview } from "@/app/admin-preview/preview-client";
export const Route = createFileRoute("/admin-preview")({
  beforeLoad: () => getAdminPreviewAccess(),
  head: () => ({ meta: [{ title: "RIIC Admin · Local preview" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: () => <AdminPreview><Outlet /></AdminPreview>,
});
