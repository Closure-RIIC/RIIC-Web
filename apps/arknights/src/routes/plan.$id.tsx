import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/plan/[id]/page";
import { getPlanArtifactPage } from "@/server/page-data";
export const Route = createFileRoute("/plan/$id")({
  loader: ({ params }) => getPlanArtifactPage({ data: params.id }),
  head: () => ({ meta: [{ title: "排班结果 · 可露希尔基建终端" }] }),
  component: withPageScrollbars(PageRoute),
});

function PageRoute() { return <Page artifact={Route.useLoaderData()} />; }
