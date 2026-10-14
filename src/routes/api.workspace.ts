import { fallbackApiMethod } from "@/server/api-methods";
import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/workspace/route";
export const Route = createFileRoute("/api/workspace")({ server: { handlers: {
    ANY: ({ request }) => fallbackApiMethod(request, ["GET","PUT","DELETE"]),
    GET: ({ request }) => api.GET(request),
    PUT: ({ request }) => api.PUT(request),
    DELETE: ({ request }) => api.DELETE(request),
} } });
