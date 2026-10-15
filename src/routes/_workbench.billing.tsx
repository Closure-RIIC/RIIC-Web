import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/(workbench)/billing/page";
import { getFeaturePageAccess } from "@/server/page-data";
export const Route = createFileRoute("/_workbench/billing")({
  beforeLoad: () => getFeaturePageAccess({ data: "billing" }),
  head: () => ({ meta: [{"title":"付费计划 · 可露希尔基建终端"},{"name":"description","content":"查看 Agent 积分余额、充值订单、工具扣费和用量统计。"}] }),
  component: withPageScrollbars(Page),
});
