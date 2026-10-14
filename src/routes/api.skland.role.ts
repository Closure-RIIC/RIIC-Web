import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/skland/role/route";
export const Route = createFileRoute("/api/skland/role")({ server: { handlers: {
    POST: ({ request }) => api.POST(request),
} } });
