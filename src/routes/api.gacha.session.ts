import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/gacha/session/route";
export const Route = createFileRoute("/api/gacha/session")({ server: { handlers: {
    GET: ({ request }) => api.GET(request),
    DELETE: ({ request }) => api.DELETE(request),
} } });
