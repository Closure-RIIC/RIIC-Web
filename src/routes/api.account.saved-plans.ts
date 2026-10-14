import { fallbackApiMethod } from "@/server/api-methods";
import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/account/saved-plans/route";
export const Route = createFileRoute("/api/account/saved-plans")({ server: { handlers: {
    ANY: ({ request }) => fallbackApiMethod(request, ["GET"]),
    GET: ({ request }) => api.GET(request),
} } });
