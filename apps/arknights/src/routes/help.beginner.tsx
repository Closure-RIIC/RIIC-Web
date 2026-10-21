import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/help/beginner")({
  beforeLoad: ({ location }) => { throw redirect({ to: "/docs/$slug", params: { slug: "video-tutorials" }, hash: location.hash, statusCode: 301, replace: true }); },
});
