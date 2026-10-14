import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/admin/plan-runs/[id]/route";
export const Route = createFileRoute("/api/admin/plan-runs/$id")({ server: { handlers: {
    GET: ({ request, params }) => api.GET(request, { params: Promise.resolve(params) }),
} } });
