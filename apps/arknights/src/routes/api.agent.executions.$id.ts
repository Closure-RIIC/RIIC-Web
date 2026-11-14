import { fallbackApiMethod } from "@/server/api-methods";
import { createFileRoute } from "@tanstack/react-router";
import * as api from "@/app/api/agent/executions/[id]/route";
export const Route = createFileRoute("/api/agent/executions/$id")({ server: { handlers: {
  ANY: ({ request }) => fallbackApiMethod(request, ["GET"]),
  GET: ({ request, params }) => api.GET(request, { params: Promise.resolve(params) }),
} } });
