import { fallbackApiMethod } from "@/server/api-methods";
import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/skland/auth/qr/route";
export const Route = createFileRoute("/api/skland/auth/qr")({ server: { handlers: {
    ANY: ({ request }) => fallbackApiMethod(request, ["POST"]),
    POST: ({ request }) => api.POST(request),
} } });
