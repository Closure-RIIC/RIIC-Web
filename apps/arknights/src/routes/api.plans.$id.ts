import { fallbackApiMethod } from "@/server/api-methods";
import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/plans/[id]/route";
export const Route = createFileRoute("/api/plans/$id")({ server: { handlers: {
    ANY: ({ request }) => fallbackApiMethod(request, ["PATCH","DELETE"]),
    PATCH: ({ request, params }) => api.PATCH(request, { params: Promise.resolve(params) }),
    DELETE: ({ request, params }) => api.DELETE(request, { params: Promise.resolve(params) }),
} } });
