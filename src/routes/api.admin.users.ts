import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/admin/users/route";
export const Route = createFileRoute("/api/admin/users")({ server: { handlers: {
    GET: ({ request }) => api.GET(request),
    POST: ({ request }) => api.POST(request),
} } });
