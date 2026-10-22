import { fallbackApiMethod } from "@/server/api-methods";
import { createFileRoute } from "@tanstack/react-router";
import * as api from "@riic/platform-server/http/skland/accounts/[id]/route";
export const Route = createFileRoute("/api/skland/accounts/$id")({ server: { handlers: {
    ANY: ({ request }) => fallbackApiMethod(request, ["DELETE"]),
    DELETE: ({ request, params }) => api.DELETE(request, { params: Promise.resolve(params) }),
} } });
