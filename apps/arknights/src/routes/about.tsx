import { withMessages } from "@/i18n/features-client";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/about/page";
import { pageHead } from "@/i18n/metadata";
const TranslatedRouteComponent = withMessages(withPageScrollbars(Page), "apps/arknights/src/routes/about.tsx");

export const Route = createFileRoute("/about")({
  head: ({ matches }) => pageHead(matches, "about"),
  component: TranslatedRouteComponent,
});
