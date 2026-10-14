import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/admin/users/[id]/route";
export const Route = createFileRoute("/api/admin/users/$id")({ server: { handlers: {
    PATCH: ({ request, params }) => api.PATCH(request, { params: Promise.resolve(params) }),
} } });
