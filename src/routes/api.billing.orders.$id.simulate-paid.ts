import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/billing/orders/[id]/simulate-paid/route";
export const Route = createFileRoute("/api/billing/orders/$id/simulate-paid")({ server: { handlers: {
    POST: ({ request, params }) => api.POST(request, { params: Promise.resolve(params) }),
} } });
