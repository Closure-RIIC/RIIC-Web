import { createFileRoute } from "@tanstack/react-router";
import { withMessages } from "@/i18n/features-client";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { AgentArchive } from "@/components/agent/AgentArchive";
import { getSuperAdminAccess } from "@/server/page-data";
function AdminArchive() { return <AgentArchive admin />; }
export const Route = createFileRoute("/admin/agent-archive")({
  beforeLoad: () => getSuperAdminAccess(),
  component: withMessages(withPageScrollbars(AdminArchive), "apps/arknights/src/routes/admin.agent-archive.tsx"),
});
