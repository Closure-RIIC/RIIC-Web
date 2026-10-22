import { createFileRoute } from "@tanstack/react-router";
import { endfieldAccessResponse } from "@riic/platform-server/auth/endfield-access";

export const Route = createFileRoute("/api/platform/endfield-access")({
  server: { handlers: { ANY: ({ request }) => endfieldAccessResponse(request) } },
});
