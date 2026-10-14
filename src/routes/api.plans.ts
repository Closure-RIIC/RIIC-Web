import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/plans/route";
export const Route = createFileRoute("/api/plans")({ server: { handlers: {
    GET: ({ request }) => api.GET(request),
} } });
