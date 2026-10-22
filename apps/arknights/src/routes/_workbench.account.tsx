import { createFileRoute, redirect } from "@tanstack/react-router";

// Preserve old bookmarks without rendering a standalone sign-in page.
export const Route = createFileRoute("/_workbench/account")({
  beforeLoad: () => { throw redirect({ href: "/settings?auth=signin", replace: true }); },
});
