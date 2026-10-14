import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/skland/sync/route";
export const Route = createFileRoute("/api/skland/sync")({ server: { handlers: {
    POST: ({ request }) => api.POST(request),
} } });
