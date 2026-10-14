import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/skill-annotations/route";
export const Route = createFileRoute("/api/skill-annotations")({ server: { handlers: {
    GET: ({ request }) => api.GET(request),
} } });
