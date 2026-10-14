import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/gacha/skland/route";
export const Route = createFileRoute("/api/gacha/skland")({ server: { handlers: {
    POST: ({ request }) => api.POST(request),
} } });
