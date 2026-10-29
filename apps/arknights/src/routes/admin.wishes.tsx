import { withMessages } from "@/i18n/features-client";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/admin/wishes/page";
const TranslatedRouteComponent = withMessages(withPageScrollbars(Page), "apps/arknights/src/routes/admin.wishes.tsx");

export const Route = createFileRoute("/admin/wishes")({
  component: TranslatedRouteComponent,
});
