import { withMessages } from "@/i18n/features-client";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/admin/schedule-gallery/page";
import { getGalleryAdminAccess } from "@/server/page-data";
import { pageHead } from "@/i18n/metadata";
const TranslatedRouteComponent = withMessages(withPageScrollbars(Page), "apps/arknights/src/routes/admin.schedule-gallery.tsx");
export const Route = createFileRoute("/admin/schedule-gallery")({
  beforeLoad: () => getGalleryAdminAccess(),
  head: ({ matches }) => pageHead(matches, "admin_schedule_gallery"),
  component: TranslatedRouteComponent,
});
