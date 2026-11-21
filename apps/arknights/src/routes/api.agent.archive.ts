import { createFileRoute } from "@tanstack/react-router";
import { fallbackApiMethod } from "@/server/api-methods";
import { conversationApi } from "@/server/agent/conversation-api";
export const Route = createFileRoute("/api/agent/archive")({ server: { handlers: {
  ANY: ({ request }) => fallbackApiMethod(request, ["GET", "POST", "DELETE"]),
  GET: ({ request }) => conversationApi(request),
  POST: ({ request }) => conversationApi(request),
  DELETE: ({ request }) => conversationApi(request),
} } });
