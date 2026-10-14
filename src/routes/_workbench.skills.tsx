import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Pending from "@/app/(workbench)/skills/loading";
import Page from "@/app/(workbench)/skills/page";
import { pageHead } from "@/i18n/metadata";
export const Route = createFileRoute("/_workbench/skills")({
  head: ({ matches }) => pageHead(matches[0].context.messages, "skills"),
  component: withPageScrollbars(Page),
  pendingComponent: Pending,
});
