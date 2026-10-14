import { fallbackApiMethod } from "@/server/api-methods";
import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/billing/cdk/route";
export const Route = createFileRoute("/api/billing/cdk")({ server: { handlers: {
    ANY: ({ request }) => fallbackApiMethod(request, ["POST"]),
    POST: ({ request }) => api.POST(request),
} } });
