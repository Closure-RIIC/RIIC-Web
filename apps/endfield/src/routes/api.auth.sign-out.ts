import { createFileRoute } from "@tanstack/react-router";
import { signOutAccount } from "../server/account-sign-out";

export const Route = createFileRoute("/api/auth/sign-out")({
  server: { handlers: { POST: ({ request }) => signOutAccount(request) } },
});
