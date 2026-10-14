import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/health/route";
export const Route = createFileRoute("/api/health")({ server: { handlers: {
    GET: () => api.GET(),
} } });
