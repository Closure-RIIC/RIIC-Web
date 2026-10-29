import { createFileRoute, redirect } from "@tanstack/react-router";
import { getChangelogWorkbench } from "../server/changelog-workbench";

export const Route = createFileRoute("/admin/changelog")({
  beforeLoad: async () => { throw redirect({ href: await getChangelogWorkbench(), replace: true }); },
});
