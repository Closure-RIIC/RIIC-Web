import { fallbackApiMethod } from "@/server/api-methods";
import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/server/schedule-poster-api";

export const Route = createFileRoute("/api/schedule-posters")({ server: { handlers: {
  ANY: ({ request }) => fallbackApiMethod(request, ["GET", "POST"]),
  GET: ({ request }) => api.getSchedulePoster(request),
  POST: ({ request }) => api.createSchedulePoster(request),
} } });
