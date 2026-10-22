import { fallbackApiMethod } from "@/server/api-methods";
import { createFileRoute } from "@tanstack/react-router";
import * as api from "@riic/platform-server/http/skland/status/route";
export const Route = createFileRoute("/api/skland/status")({ server: { handlers: {
    ANY: ({ request }) => fallbackApiMethod(request, ["GET"]),
    GET: ({ request }) => api.GET(request),
} } });
