import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/admin/solver-metrics/route";
export const Route = createFileRoute("/api/admin/solver-metrics")({ server: { handlers: {
    GET: ({ request }) => api.GET(request),
} } });
