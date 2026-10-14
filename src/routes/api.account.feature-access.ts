import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/account/feature-access/route";
export const Route = createFileRoute("/api/account/feature-access")({ server: { handlers: {
    GET: ({ request }) => api.GET(request),
} } });
