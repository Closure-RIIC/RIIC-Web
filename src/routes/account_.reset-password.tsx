import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/account/reset-password/page";
import { pageHead } from "@/i18n/metadata";
export const Route = createFileRoute("/account_/reset-password")({
  head: ({ matches }) => pageHead(matches[0].context.messages, "account_reset_password"),
  component: withPageScrollbars(Page),
});
