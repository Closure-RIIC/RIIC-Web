import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/(workbench)/agent/page";
import { getFeaturePageAccess } from "@/server/page-data";
export const Route = createFileRoute("/_workbench/agent")({
  beforeLoad: () => getFeaturePageAccess({ data: "agent" }),
  head: () => ({ meta: [{"title":"可露希尔助理 · 可露希尔基建终端"},{"name":"description","content":"实验性 agent 入口：串联账号诊断、排班求解、技能查询与知识库。"}] }),
  component: withPageScrollbars(Page),
});
