import { withMessages } from "@/i18n/features-client";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/admin/skills/page";
import { pageHead } from "@/i18n/metadata";
import { getAdminAccess } from "@/server/page-data";
const TranslatedRouteComponent = withMessages(withPageScrollbars(Page), "apps/arknights/src/routes/admin.skills.tsx");

export const Route = createFileRoute("/admin/skills")({
  beforeLoad: () => getAdminAccess(),
  head: ({ matches }) => pageHead(matches, "admin_skills"),
  component: TranslatedRouteComponent,
});
