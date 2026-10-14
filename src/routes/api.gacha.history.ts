import { fallbackApiMethod } from "@/server/api-methods";
import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/gacha/history/route";
export const Route = createFileRoute("/api/gacha/history")({ server: { handlers: {
    ANY: ({ request }) => fallbackApiMethod(request, ["GET","POST","DELETE"]),
    GET: ({ request }) => api.GET(request),
    POST: ({ request }) => api.POST(request),
    DELETE: ({ request }) => api.DELETE(request),
} } });
