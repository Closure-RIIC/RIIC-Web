import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/admin/billing/route";
export const Route = createFileRoute("/api/admin/billing")({ server: { handlers: {
    GET: ({ request }) => api.GET(request),
    POST: ({ request }) => api.POST(request),
} } });
