import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/admin/quality/import/route";
export const Route = createFileRoute("/api/admin/quality/import")({ server: { handlers: {
    POST: ({ request }) => api.POST(request),
} } });
