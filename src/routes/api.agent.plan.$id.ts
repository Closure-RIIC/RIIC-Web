import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/agent/plan/[id]/route";
export const Route = createFileRoute("/api/agent/plan/$id")({ server: { handlers: {
    GET: ({ request, params }) => api.GET(request, { params: Promise.resolve(params) }),
} } });
