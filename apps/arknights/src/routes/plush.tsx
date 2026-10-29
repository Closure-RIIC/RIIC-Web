import { pageHead } from "@/i18n/metadata";
import { withMessages } from "@/i18n/features-client";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import { PlushGallery } from "@/app/plush/PlushGallery";
const TranslatedRouteComponent = withMessages(withPageScrollbars(PageRoute), "apps/arknights/src/routes/plush.tsx");

export const Route = createFileRoute("/plush")({
  validateSearch: (search: Record<string, unknown>) => ({ debug: search.debug === "1" || search.debug === 1 ? "1" : undefined }),
  head: ({ matches }) => pageHead(matches, "plush"),
  component: TranslatedRouteComponent,
});

function PageRoute() { return <PlushGallery debug={Route.useSearch().debug === "1"} />; }
