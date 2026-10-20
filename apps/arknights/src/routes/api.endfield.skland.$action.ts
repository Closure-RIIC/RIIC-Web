import { createFileRoute } from "@tanstack/react-router";
import { handleEndfieldSkland } from "@/server/skland/endfield-api";

export const Route = createFileRoute("/api/endfield/skland/$action")({
  server: { handlers: {
    GET: ({ request, params }) => handleEndfieldSkland(request, params.action),
    POST: ({ request, params }) => handleEndfieldSkland(request, params.action),
  } },
});
