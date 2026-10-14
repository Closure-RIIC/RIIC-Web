import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/billing/route";
export const Route = createFileRoute("/api/billing")({ server: { handlers: {
    GET: ({ request }) => api.GET(request),
    POST: ({ request }) => api.POST(request),
} } });
