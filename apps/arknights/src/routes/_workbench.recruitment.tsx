import { withMessages } from "@/i18n/features-client";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/(workbench)/recruitment/page";
import { pageHead } from "@/i18n/metadata";
const TranslatedRouteComponent = withMessages(withPageScrollbars(Page), "apps/arknights/src/routes/_workbench.recruitment.tsx");

export const Route = createFileRoute("/_workbench/recruitment")({
  head: ({ matches }) => pageHead(matches, "recruitment"),
  component: TranslatedRouteComponent,
});
