import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/plan/route";
export const Route = createFileRoute("/api/plan")({ server: { handlers: {
    POST: ({ request }) => api.POST(request),
} } });
