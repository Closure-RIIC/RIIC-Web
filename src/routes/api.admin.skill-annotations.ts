import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/admin/skill-annotations/route";
export const Route = createFileRoute("/api/admin/skill-annotations")({ server: { handlers: {
    GET: ({ request }) => api.GET(request),
    POST: ({ request }) => api.POST(request),
} } });
