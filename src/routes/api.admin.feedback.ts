import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/admin/feedback/route";
export const Route = createFileRoute("/api/admin/feedback")({ server: { handlers: {
    GET: ({ request }) => api.GET(request),
    DELETE: ({ request }) => api.DELETE(request),
    PATCH: ({ request }) => api.PATCH(request),
} } });
