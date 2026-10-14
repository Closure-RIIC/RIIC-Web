import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/wishes/route";
export const Route = createFileRoute("/api/wishes")({ server: { handlers: {
    GET: () => api.GET(),
    POST: ({ request }) => api.POST(request),
} } });
