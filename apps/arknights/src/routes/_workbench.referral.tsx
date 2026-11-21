import { createFileRoute } from "@tanstack/react-router";
import { ReferralPage } from "@/components/referral/ReferralPage";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { withMessages } from "@/i18n/features-client";
import { pageHead } from "@/i18n/metadata";

const TranslatedRouteComponent = withMessages(withPageScrollbars(ReferralPage), "apps/arknights/src/routes/_workbench.referral.tsx");

export const Route = createFileRoute("/_workbench/referral")({
  head: ({ matches }) => ({ meta: [...(pageHead(matches, "referral").meta ?? []), { name: "robots", content: "noindex, nofollow" }] }),
  component: TranslatedRouteComponent,
});
