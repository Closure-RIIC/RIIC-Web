import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/releases/route";
export const Route = createFileRoute("/api/releases")({ server: { handlers: {
    GET: ({ request }) => api.GET(request),
} } });
