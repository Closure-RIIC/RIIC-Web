import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/account/session/extend/route";
export const Route = createFileRoute("/api/account/session/extend")({ server: { handlers: {
    POST: ({ request }) => api.POST(request),
} } });
