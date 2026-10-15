import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/wishes3")({ beforeLoad: () => { throw redirect({ to: "/wishes" }); } });
