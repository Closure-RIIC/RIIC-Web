import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/admin/records/route";
export const Route = createFileRoute("/api/admin/records")({ server: { handlers: {
    GET: ({ request }) => api.GET(request),
    PATCH: ({ request }) => api.PATCH(request),
} } });
