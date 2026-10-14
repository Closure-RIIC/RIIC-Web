import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/skland/auth/credential/route";
export const Route = createFileRoute("/api/skland/auth/credential")({ server: { handlers: {
    POST: ({ request }) => api.POST(request),
} } });
