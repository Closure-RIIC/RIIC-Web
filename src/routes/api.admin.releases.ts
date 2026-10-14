import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/admin/releases/route";
export const Route = createFileRoute("/api/admin/releases")({ server: { handlers: {
    GET: ({ request }) => api.GET(request),
    POST: ({ request }) => api.POST(request),
} } });
