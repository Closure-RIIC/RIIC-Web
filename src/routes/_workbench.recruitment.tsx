import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/(workbench)/recruitment/page";
import { pageHead } from "@/i18n/metadata";
export const Route = createFileRoute("/_workbench/recruitment")({
  head: ({ matches }) => pageHead(matches, "recruitment"),
  component: withPageScrollbars(Page),
});
