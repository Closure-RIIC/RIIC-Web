import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/account/saved-plans/route";
export const Route = createFileRoute("/api/account/saved-plans")({ server: { handlers: {
    GET: ({ request }) => api.GET(request),
} } });
