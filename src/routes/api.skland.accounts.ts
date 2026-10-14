import { fallbackApiMethod } from "@/server/api-methods";
import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/skland/accounts/route";
export const Route = createFileRoute("/api/skland/accounts")({ server: { handlers: {
    ANY: ({ request }) => fallbackApiMethod(request, ["GET","DELETE"]),
    GET: ({ request }) => api.GET(request),
    DELETE: ({ request }) => api.DELETE(request),
} } });
