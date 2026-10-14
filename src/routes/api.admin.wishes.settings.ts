import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/admin/wishes/settings/route";
export const Route = createFileRoute("/api/admin/wishes/settings")({ server: { handlers: {
    GET: ({ request }) => api.GET(request),
    PUT: ({ request }) => api.PUT(request),
} } });
