import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/admin/changelog/page";
import { pageHead } from "@/i18n/metadata";
import { getAdminAccess } from "@/server/page-data";
export const Route = createFileRoute("/admin/changelog")({
  beforeLoad: () => getAdminAccess(),
  head: ({ matches }) => pageHead(matches, "changelog"),
  component: withPageScrollbars(Page),
});
