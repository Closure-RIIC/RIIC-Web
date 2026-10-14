import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/tasks/route";
export const Route = createFileRoute("/api/tasks")({ server: { handlers: {
    POST: ({ request }) => api.POST(request),
} } });
