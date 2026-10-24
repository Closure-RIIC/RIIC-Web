import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/step")({
  beforeLoad: ({ search }) => { throw redirect({ to: "/manual", search: { ...search, view: "simulation" }, replace: true }); },
});
