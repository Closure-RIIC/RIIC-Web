import { fallbackApiMethod } from "@/server/api-methods";
import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/account/data-consent/route";
export const Route = createFileRoute("/api/account/data-consent")({ server: { handlers: {
    ANY: ({ request }) => fallbackApiMethod(request, ["GET","POST","DELETE"]),
    GET: ({ request }) => api.GET(request),
    POST: ({ request }) => api.POST(request),
    DELETE: ({ request }) => api.DELETE(request),
} } });
