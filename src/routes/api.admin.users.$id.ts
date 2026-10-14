import { fallbackApiMethod } from "@/server/api-methods";
import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/admin/users/[id]/route";
export const Route = createFileRoute("/api/admin/users/$id")({ server: { handlers: {
    ANY: ({ request }) => fallbackApiMethod(request, ["PATCH"]),
    PATCH: ({ request, params }) => api.PATCH(request, { params: Promise.resolve(params) }),
} } });
