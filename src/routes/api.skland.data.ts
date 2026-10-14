import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/skland/data/route";
export const Route = createFileRoute("/api/skland/data")({ server: { handlers: {
    DELETE: ({ request }) => api.DELETE(request),
} } });
