import { withMessages } from "@/i18n/features-client";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/admin/changelog/page";
import { pageHead } from "@/i18n/metadata";
import { getAdminAccess } from "@/server/page-data";
const TranslatedRouteComponent = withMessages(withPageScrollbars(Page), "apps/arknights/src/routes/admin.changelog.tsx");

export const Route = createFileRoute("/admin/changelog")({
  beforeLoad: () => getAdminAccess(),
  head: ({ matches }) => pageHead(matches, "changelog"),
  component: TranslatedRouteComponent,
});
