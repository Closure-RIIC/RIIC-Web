import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/skland/accounts/[id]/route";
export const Route = createFileRoute("/api/skland/accounts/$id")({ server: { handlers: {
    DELETE: ({ request, params }) => api.DELETE(request, { params: Promise.resolve(params) }),
} } });
