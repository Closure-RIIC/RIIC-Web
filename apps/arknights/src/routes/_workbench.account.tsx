import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Pending from "@/app/(workbench)/account/loading";
import Page from "@/app/(workbench)/account/page";
import { pageHead } from "@/i18n/metadata";
export const Route = createFileRoute("/_workbench/account")({
  head: ({ matches }) => pageHead(matches, "account"),
  component: withPageScrollbars(Page),
  pendingComponent: Pending,
});
