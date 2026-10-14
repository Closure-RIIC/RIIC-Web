import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/admin/diagnostics/route";
export const Route = createFileRoute("/api/admin/diagnostics")({ server: { handlers: {
    GET: ({ request }) => api.GET(request),
} } });
