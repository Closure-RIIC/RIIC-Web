import { createFileRoute } from "@tanstack/react-router";
import { fallbackApiMethod } from "@/server/api-methods";
import { GET } from "@/app/api/referral/route";

export const Route = createFileRoute("/api/referral")({ server: { handlers: {
  ANY: ({ request }) => fallbackApiMethod(request, ["GET"]),
  GET: ({ request }) => GET(request),
} } });
