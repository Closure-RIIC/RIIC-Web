import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/skland/auth/qr/route";
export const Route = createFileRoute("/api/skland/auth/qr")({ server: { handlers: {
    POST: ({ request }) => api.POST(request),
} } });
