import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/skland/status/route";
export const Route = createFileRoute("/api/skland/status")({ server: { handlers: {
    GET: ({ request }) => api.GET(request),
} } });
