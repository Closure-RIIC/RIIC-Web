import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/admin/skill-annotations/[id]/route";
export const Route = createFileRoute("/api/admin/skill-annotations/$id")({ server: { handlers: {
    PATCH: ({ request, params }) => api.PATCH(request, { params: Promise.resolve(params) }),
    DELETE: ({ request, params }) => api.DELETE(request, { params: Promise.resolve(params) }),
} } });
