import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/admin/users/[id]/sessions/route";
export const Route = createFileRoute("/api/admin/users/$id/sessions")({ server: { handlers: {
    GET: ({ request, params }) => api.GET(request, { params: Promise.resolve(params) }),
    DELETE: ({ request, params }) => api.DELETE(request, { params: Promise.resolve(params) }),
} } });
