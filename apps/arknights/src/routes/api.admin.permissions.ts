import { createFileRoute } from "@tanstack/react-router";
import { fallbackApiMethod } from "@/server/api-methods";
import { handleGetAdminPermissions } from "@/server/admin-users-api";

export const Route = createFileRoute("/api/admin/permissions")({ server: { handlers: {
  ANY: ({ request }) => fallbackApiMethod(request, ["GET"]),
  GET: ({ request }) => handleGetAdminPermissions(request),
} } });
