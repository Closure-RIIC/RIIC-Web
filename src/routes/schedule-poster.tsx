import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/schedule-poster")({
  beforeLoad: ({ location }) => {
    const query = new URLSearchParams(location.searchStr);
    query.set("tab", "poster");
    throw redirect({ href: `/manual?${query.toString()}`, replace: true });
  },
});
