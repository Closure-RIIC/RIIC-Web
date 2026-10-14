import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/billing/orders/[id]/route";
export const Route = createFileRoute("/api/billing/orders/$id")({ server: { handlers: {
    GET: ({ request, params }) => api.GET(request, { params: Promise.resolve(params) }),
} } });
