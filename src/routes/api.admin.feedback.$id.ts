import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/admin/feedback/[id]/route";
export const Route = createFileRoute("/api/admin/feedback/$id")({ server: { handlers: {
    GET: ({ request, params }) => api.GET(request, { params: Promise.resolve(params) }),
    PATCH: ({ request, params }) => api.PATCH(request, { params: Promise.resolve(params) }),
} } });
