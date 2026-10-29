import { withMessages } from "@/i18n/features-client";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import { PreviewPage } from "@/app/admin-preview/preview-page";
const TranslatedRouteComponent = withMessages(withPageScrollbars(AdminPreviewIndex), "apps/arknights/src/routes/admin-preview.index.tsx");

export const Route = createFileRoute("/admin-preview/")({
  component: TranslatedRouteComponent,
});

function AdminPreviewIndex() {
  return <PreviewPage section="" />;
}
