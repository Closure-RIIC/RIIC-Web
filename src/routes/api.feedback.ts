import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/feedback/route";
export const Route = createFileRoute("/api/feedback")({ server: { handlers: {
    POST: ({ request }) => api.POST(request),
} } });
