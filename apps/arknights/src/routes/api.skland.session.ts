import { fallbackApiMethod } from "@/server/api-methods";
import { createFileRoute } from "@tanstack/react-router";
import * as api from "@riic/platform-server/http/skland/session/route";
export const Route = createFileRoute("/api/skland/session")({ server: { handlers: {
    ANY: ({ request }) => fallbackApiMethod(request, ["GET","DELETE"]),
    GET: ({ request }) => api.GET(request),
    DELETE: ({ request }) => api.DELETE(request),
} } });
