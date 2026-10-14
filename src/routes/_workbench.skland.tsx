import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute, notFound } from "@tanstack/react-router";
import Page from "@/app/(workbench)/skland/page";
import { pageHead } from "@/i18n/metadata";
export const Route = createFileRoute("/_workbench/skland")({
  beforeLoad: ({ context }) => { if (!context.publicConfig.sklandEnabled) throw notFound(); },
  head: ({ matches }) => pageHead(matches[0].context.messages, "skland"),
  component: withPageScrollbars(Page),
});
