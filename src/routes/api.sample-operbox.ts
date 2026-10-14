import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/sample-operbox/route";
export const Route = createFileRoute("/api/sample-operbox")({ server: { handlers: {
    GET: () => api.GET(),
} } });
