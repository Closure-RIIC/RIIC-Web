import { fallbackApiMethod } from "@/server/api-methods";
import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/skill-annotations/route";
export const Route = createFileRoute("/api/skill-annotations")({ server: { handlers: {
    ANY: ({ request }) => fallbackApiMethod(request, ["GET"]),
    GET: ({ request }) => api.GET(request),
} } });
