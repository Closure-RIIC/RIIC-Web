import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/telemetry/route";
export const Route = createFileRoute("/api/telemetry")({ server: { handlers: {
    POST: ({ request }) => api.POST(request),
} } });
