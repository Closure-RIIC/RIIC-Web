import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/skland/inventory/route";
export const Route = createFileRoute("/api/skland/inventory")({ server: { handlers: {
    GET: ({ request }) => api.GET(request),
} } });
