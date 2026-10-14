import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/agent/chat/route";
export const Route = createFileRoute("/api/agent/chat")({ server: { handlers: {
    GET: ({ request }) => api.GET(request),
    POST: ({ request }) => api.POST(request),
} } });
