import { fallbackApiMethod } from "@/server/api-methods";
import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/admin/users/route";
export const Route = createFileRoute("/api/admin/users")({ server: { handlers: {
    ANY: ({ request }) => fallbackApiMethod(request, ["GET","POST"]),
    GET: ({ request }) => api.GET(request),
    POST: ({ request }) => api.POST(request),
} } });
