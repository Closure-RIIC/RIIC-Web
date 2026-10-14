import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/wishes2/page";
export const Route = createFileRoute("/wishes2")({
  component: withPageScrollbars(Page),
});
