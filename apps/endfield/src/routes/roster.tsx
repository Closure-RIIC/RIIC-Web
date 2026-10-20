import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/roster")({
  beforeLoad: () => { throw redirect({ to: "/", search: { roster: true }, replace: true }); },
});
