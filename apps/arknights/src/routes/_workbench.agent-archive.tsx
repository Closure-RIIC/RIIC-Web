import { createFileRoute } from "@tanstack/react-router";
import { withMessages } from "@/i18n/features-client";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { AgentArchive } from "@/components/agent/AgentArchive";
export const Route = createFileRoute("/_workbench/agent-archive")({
  component: withMessages(withPageScrollbars(AgentArchive), "apps/arknights/src/routes/_workbench.agent-archive.tsx"),
});
