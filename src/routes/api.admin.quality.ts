import { fallbackApiMethod } from "@/server/api-methods";
import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/admin/quality/route";
export const Route = createFileRoute("/api/admin/quality")({ server: { handlers: {
    ANY: ({ request }) => fallbackApiMethod(request, ["GET","POST"]),
    GET: ({ request }) => api.GET(request),
    POST: ({ request }) => api.POST(request),
} } });
