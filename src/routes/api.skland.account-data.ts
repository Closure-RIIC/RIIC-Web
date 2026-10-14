import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/skland/account-data/route";
export const Route = createFileRoute("/api/skland/account-data")({ server: { handlers: {
    DELETE: ({ request }) => api.DELETE(request),
} } });
