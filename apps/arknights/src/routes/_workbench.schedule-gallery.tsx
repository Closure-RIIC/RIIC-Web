import { withMessages } from "@/i18n/features-client";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/components/pages/ScheduleGalleryPage";
import { pageHead } from "@/i18n/metadata";

const TranslatedRouteComponent = withMessages(withPageScrollbars(Page), "apps/arknights/src/routes/_workbench.schedule-gallery.tsx");
export const Route = createFileRoute("/_workbench/schedule-gallery")({
  head: ({ matches }) => pageHead(matches, "scheduleGallery"),
  component: TranslatedRouteComponent,
});
