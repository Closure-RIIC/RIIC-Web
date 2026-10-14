import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/account/saved-plans/[id]/route";
export const Route = createFileRoute("/api/account/saved-plans/$id")({ server: { handlers: {
    PATCH: ({ request, params }) => api.PATCH(request, { params: Promise.resolve(params) }),
    DELETE: ({ request, params }) => api.DELETE(request, { params: Promise.resolve(params) }),
} } });
