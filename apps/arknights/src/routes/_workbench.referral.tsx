import { createFileRoute } from "@tanstack/react-router";
import { ReferralPage } from "@/components/referral/ReferralPage";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";

export const Route = createFileRoute("/_workbench/referral")({
  head: () => ({ meta: [
    { title: "邀请返利 · 可露希尔基建终端" },
    { name: "description", content: "邀请好友一起使用可露希尔基建终端，查看邀请奖励与好友进度。" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: withPageScrollbars(ReferralPage),
});
