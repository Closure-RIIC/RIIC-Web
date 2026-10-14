import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { PreviewPage } from "@/app/admin-preview/preview-page";
export const Route = createFileRoute("/admin-preview/$")({
  beforeLoad: ({ params }) => { if (!["users", "issues", "quality", "skills", "changelog"].includes(params._splat ?? "")) throw notFound(); },
  component: withPageScrollbars(PageRoute),
});

function PageRoute() { return <PreviewPage section={Route.useParams()._splat ?? ""} />; }
