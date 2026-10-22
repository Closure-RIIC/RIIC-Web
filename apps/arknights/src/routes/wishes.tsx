import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/wishes/page";
export const Route = createFileRoute("/wishes")({
  component: withPageScrollbars(Page),
});
