import { createFileRoute } from "@tanstack/react-router";
import { authenticateAccount } from "../server/account-auth";
export const Route = createFileRoute("/api/auth/$")({
  server: { handlers: { GET: ({ request }) => authenticateAccount(request), POST: ({ request }) => authenticateAccount(request) } },
});
