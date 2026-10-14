import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/auth/[...all]/route";
export const Route = createFileRoute("/api/auth/$")({ server: { handlers: {
    GET: ({ request }) => api.GET(request),
    POST: ({ request }) => api.POST(request),
} } });
