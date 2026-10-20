import { fallbackApiMethod } from "@/server/api-methods";
import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/billing/route";
export const Route = createFileRoute("/api/billing")({ server: { handlers: {
    ANY: ({ request }) => fallbackApiMethod(request, ["GET","POST","DELETE"]),
    DELETE: ({ request }) => api.DELETE(request),
    GET: ({ request }) => api.GET(request),
    POST: ({ request }) => api.POST(request),
} } });
