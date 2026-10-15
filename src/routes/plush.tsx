import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import { PlushGallery } from "@/app/plush/PlushGallery";
export const Route = createFileRoute("/plush")({
  validateSearch: (search: Record<string, unknown>) => ({ debug: search.debug === "1" || search.debug === 1 ? "1" : undefined }),
  head: () => ({ meta: [{ title: "毛绒小伙伴 · RIIC" }, { name: "description", content: "可露希尔、银灰、能天使、琴柳与山的毛绒展示间。拖动看看，轻轻按一下。" }] }),
  component: withPageScrollbars(PageRoute),
});

function PageRoute() { return <PlushGallery debug={Route.useSearch().debug === "1"} />; }
