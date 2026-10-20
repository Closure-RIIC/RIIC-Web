import { createFileRoute, Outlet } from "@tanstack/react-router";
import WorkbenchLayout from "@/app/(workbench)/layout";
import { getInitialWebsiteSession } from "@/server/session-bootstrap";

export const Route = createFileRoute("/_workbench")({
  // Bootstrap each document from its own authenticated request. Client navigation
  // uses the mounted provider, never an old router-cached identity.
  loader: () => import.meta.env.SSR ? getInitialWebsiteSession() : undefined,
  component: WorkbenchRoute,
});

function WorkbenchRoute() {
  const initialSession = Route.useLoaderData();
  return <WorkbenchLayout initialSession={initialSession}><Outlet /></WorkbenchLayout>;
}
