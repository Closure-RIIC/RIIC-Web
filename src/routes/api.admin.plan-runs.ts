import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/admin/plan-runs/route";
export const Route = createFileRoute("/api/admin/plan-runs")({ server: { handlers: {
    GET: ({ request }) => api.GET(request),
} } });
