import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/admin/billing/cdk/route";
export const Route = createFileRoute("/api/admin/billing/cdk")({ server: { handlers: {
    GET: ({ request }) => api.GET(request),
    POST: ({ request }) => api.POST(request),
    PATCH: ({ request }) => api.PATCH(request),
} } });
