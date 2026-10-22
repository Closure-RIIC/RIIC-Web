import { fallbackApiMethod } from "@/server/api-methods";
import { createFileRoute } from "@tanstack/react-router";
import * as api from "@riic/platform-server/http/skland/data/route";
export const Route = createFileRoute("/api/skland/data")({ server: { handlers: {
    ANY: ({ request }) => fallbackApiMethod(request, ["DELETE"]),
    DELETE: ({ request }) => api.DELETE(request),
} } });
