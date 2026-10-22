import { fallbackApiMethod } from "@/server/api-methods";
import { createFileRoute } from "@tanstack/react-router";
import * as api from "@riic/platform-server/http/auth/[...all]/route";
export const Route = createFileRoute("/api/auth/$")({ server: { handlers: {
    ANY: ({ request }) => fallbackApiMethod(request, ["GET","POST"]),
    GET: ({ request }) => api.GET(request),
    POST: ({ request }) => api.POST(request),
} } });
