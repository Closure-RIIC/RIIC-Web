import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/tasks/[id]/route";
export const Route = createFileRoute("/api/tasks/$id")({ server: { handlers: {
    GET: ({ request, params }) => api.GET(request, { params: Promise.resolve(params) }),
    DELETE: ({ request, params }) => api.DELETE(request, { params: Promise.resolve(params) }),
} } });
