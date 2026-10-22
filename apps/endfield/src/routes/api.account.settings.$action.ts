import { createFileRoute } from "@tanstack/react-router";
import { accountSettings } from "../server/account-settings";

export const Route = createFileRoute("/api/account/settings/$action")({
  server: { handlers: { POST: ({ request, params }) => accountSettings(request, params.action) } },
});
