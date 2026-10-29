import { withMessages } from "@/i18n/features-client";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { PreviewPage } from "@/app/admin-preview/preview-page";
const TranslatedRouteComponent = withMessages(withPageScrollbars(PageRoute), "apps/arknights/src/routes/admin-preview.$.tsx");

export const Route = createFileRoute("/admin-preview/$")({
  beforeLoad: ({ params }) => { if (!["users", "issues", "quality", "skills", "changelog"].includes(params._splat ?? "")) throw notFound(); },
  component: TranslatedRouteComponent,
});

function PageRoute() { return <PreviewPage section={Route.useParams()._splat ?? ""} />; }
