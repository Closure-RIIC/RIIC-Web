import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/billing/webhooks/afdian/route";
export const Route = createFileRoute("/api/billing/webhooks/afdian")({ server: { handlers: {
    GET: () => api.GET(),
    POST: ({ request }) => api.POST(request),
} } });
