import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/gacha/qr/status/route";
export const Route = createFileRoute("/api/gacha/qr/status")({ server: { handlers: {
    POST: ({ request }) => api.POST(request),
} } });
