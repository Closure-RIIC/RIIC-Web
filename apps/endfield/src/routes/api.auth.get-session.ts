import { createFileRoute } from "@tanstack/react-router";
import { readAccountSession } from "../server/account-session";
export const Route = createFileRoute("/api/auth/get-session")({
  server: { handlers: { GET: ({ request }) => readAccountSession(request) } },
});
