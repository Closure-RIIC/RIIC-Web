import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import { PreviewPage } from "@/app/admin-preview/preview-page";
export const Route = createFileRoute("/admin-preview/")({
  component: withPageScrollbars(AdminPreviewIndex),
});

function AdminPreviewIndex() {
  return <PreviewPage section="" />;
}
