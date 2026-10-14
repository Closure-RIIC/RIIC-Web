import { fallbackApiMethod } from "@/server/api-methods";
import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/admin/wishes/route";
export const Route = createFileRoute("/api/admin/wishes")({ server: { handlers: {
    ANY: ({ request }) => fallbackApiMethod(request, ["GET","PATCH"]),
    GET: ({ request }) => api.GET(request),
    PATCH: ({ request }) => api.PATCH(request),
} } });
