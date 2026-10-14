import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/account/game-report/route";
export const Route = createFileRoute("/api/account/game-report")({ server: { handlers: {
    GET: ({ request }) => api.GET(request),
    POST: ({ request }) => api.POST(request),
} } });
