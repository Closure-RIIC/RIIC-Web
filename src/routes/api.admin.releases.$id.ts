import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/admin/releases/[id]/route";
export const Route = createFileRoute("/api/admin/releases/$id")({ server: { handlers: {
    PATCH: ({ request, params }) => api.PATCH(request, { params: Promise.resolve(params) }),
} } });
