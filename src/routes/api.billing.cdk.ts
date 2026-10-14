import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/billing/cdk/route";
export const Route = createFileRoute("/api/billing/cdk")({ server: { handlers: {
    POST: ({ request }) => api.POST(request),
} } });
