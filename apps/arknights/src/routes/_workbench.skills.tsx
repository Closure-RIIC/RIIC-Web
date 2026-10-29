import { withMessages } from "@/i18n/features-client";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Pending from "@/app/(workbench)/skills/loading";
import Page from "@/app/(workbench)/skills/page";
import { pageHead } from "@/i18n/metadata";
const TranslatedRouteComponent = withMessages(withPageScrollbars(Page), "apps/arknights/src/routes/_workbench.skills.tsx");

export const Route = createFileRoute("/_workbench/skills")({
  head: ({ matches }) => pageHead(matches, "skills"),
  component: TranslatedRouteComponent,
  pendingComponent: Pending,
});
