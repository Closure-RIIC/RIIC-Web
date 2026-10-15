import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/admin/skills/page";
import { pageHead } from "@/i18n/metadata";
import { getAdminAccess } from "@/server/page-data";
export const Route = createFileRoute("/admin/skills")({
  beforeLoad: () => getAdminAccess(),
  head: ({ matches }) => pageHead(matches[0].context.messages, "admin_skills"),
  component: withPageScrollbars(Page),
});
