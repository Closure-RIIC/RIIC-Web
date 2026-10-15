import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { isSklandTab } from "@/workbench-routes";
import { SklandRoute } from "workbench-skland-route";
import { pageHead } from "@/i18n/metadata";
export const Route = createFileRoute("/_workbench/skland/$tab")({
  beforeLoad: ({ params }) => {
    if (process.env.APP_CLIENT_SKLAND_ENABLED !== "1") throw notFound();
    if (params.tab === "gacha") throw redirect({ to: "/gacha" });
    if (!isSklandTab(params.tab)) throw notFound();
    if (params.tab === "overview") throw redirect({ to: "/skland" });
  },
  head: ({ matches }) => pageHead(matches[0].context.messages, "skland"),
  component: withPageScrollbars(SklandRoute),
});
