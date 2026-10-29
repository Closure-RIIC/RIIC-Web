import { withMessages } from "@/i18n/features-client";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import WorkbenchLayout from "@/app/(workbench)/layout";
import { getInitialWebsiteSession } from "@/server/session-bootstrap";

const TranslatedRouteComponent = withMessages(WorkbenchRoute, "apps/arknights/src/routes/_workbench.tsx");

export const Route = createFileRoute("/_workbench")({
  // Bootstrap each document from its own authenticated request. Client navigation
  // uses the mounted provider, never an old router-cached identity.
  loader: () => import.meta.env.SSR ? getInitialWebsiteSession() : undefined,
  component: TranslatedRouteComponent,
});

function WorkbenchRoute() {
  const initialSession = Route.useLoaderData();
  return <WorkbenchLayout initialSession={initialSession}><Outlet /></WorkbenchLayout>;
}
