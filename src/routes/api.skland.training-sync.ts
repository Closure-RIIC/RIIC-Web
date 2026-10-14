import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/skland/training-sync/route";
export const Route = createFileRoute("/api/skland/training-sync")({ server: { handlers: {
    POST: ({ request }) => api.POST(request),
} } });
