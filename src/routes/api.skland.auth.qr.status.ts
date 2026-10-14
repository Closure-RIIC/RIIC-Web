import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/skland/auth/qr/status/route";
export const Route = createFileRoute("/api/skland/auth/qr/status")({ server: { handlers: {
    POST: ({ request }) => api.POST(request),
} } });
