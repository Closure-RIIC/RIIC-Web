import { pageHead } from "@/i18n/metadata";
import { withMessages } from "@/i18n/features-client";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/plan/[id]/page";
import { getPlanArtifactPage } from "@/server/page-data";
const TranslatedRouteComponent = withMessages(withPageScrollbars(PageRoute), "apps/arknights/src/routes/plan.$id.tsx");

export const Route = createFileRoute("/plan/$id")({
  loader: ({ params }) => getPlanArtifactPage({ data: params.id }),
  head: ({ matches }) => pageHead(matches, "plan"),
  component: TranslatedRouteComponent,
});

function PageRoute() { return <Page artifact={Route.useLoaderData()} />; }
