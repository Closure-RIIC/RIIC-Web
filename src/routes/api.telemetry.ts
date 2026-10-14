import { fallbackApiMethod } from "@/server/api-methods";
import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/telemetry/route";
export const Route = createFileRoute("/api/telemetry")({ server: { handlers: {
    ANY: ({ request }) => fallbackApiMethod(request, ["POST"]),
    POST: ({ request }) => api.POST(request),
} } });
