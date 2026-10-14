import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/skland/accounts/route";
export const Route = createFileRoute("/api/skland/accounts")({ server: { handlers: {
    GET: ({ request }) => api.GET(request),
    DELETE: ({ request }) => api.DELETE(request),
} } });
