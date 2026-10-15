import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/(workbench)/account-health/page";
import { pageHead } from "@/i18n/metadata";
export const Route = createFileRoute("/_workbench/account-health")({
  head: ({ matches }) => pageHead(matches, "account_health"),
  component: withPageScrollbars(Page),
});
