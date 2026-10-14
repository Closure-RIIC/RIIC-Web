import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/readiness/route";
export const Route = createFileRoute("/api/readiness")({ server: { handlers: {
    GET: () => api.GET(),
} } });
