import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/admin/agent/resources/route";
export const Route = createFileRoute("/api/admin/agent/resources")({ server: { handlers: {
    GET: ({ request }) => api.GET(request),
    POST: ({ request }) => api.POST(request),
} } });
