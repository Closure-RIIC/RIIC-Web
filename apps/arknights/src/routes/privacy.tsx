import { withMessages } from "@/i18n/features-client";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/privacy/page";
import { pageHead } from "@/i18n/metadata";
const TranslatedRouteComponent = withMessages(withPageScrollbars(Page), "apps/arknights/src/routes/privacy.tsx");

export const Route = createFileRoute("/privacy")({
  head: ({ matches }) => pageHead(matches, "privacy"),
  component: TranslatedRouteComponent,
});
