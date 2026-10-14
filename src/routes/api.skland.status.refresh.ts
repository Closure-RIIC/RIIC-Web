import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/skland/status/refresh/route";
export const Route = createFileRoute("/api/skland/status/refresh")({ server: { handlers: {
    POST: ({ request }) => api.POST(request),
} } });
