import { createFileRoute } from "@tanstack/react-router";
import { forwardEndfieldSkland } from "../server/skland-proxy";

export const Route = createFileRoute("/api/skland/$action")({
  server: { handlers: {
    GET: ({ request, params }) => forwardEndfieldSkland(request, params.action),
    POST: ({ request, params }) => forwardEndfieldSkland(request, params.action),
  } },
});
