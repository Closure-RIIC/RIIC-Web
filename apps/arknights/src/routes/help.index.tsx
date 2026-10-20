import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/help/")({
  beforeLoad: ({ location }) => {
    if (location.hash === "base-knowledge") throw redirect({ to: "/docs/$slug", params: { slug: "faq" }, statusCode: 301, replace: true });
    throw redirect({ to: "/docs", statusCode: 301, replace: true });
  },
});
