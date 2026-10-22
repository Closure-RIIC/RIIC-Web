import { createFileRoute } from "@tanstack/react-router";
import { readAccountFeatureAccess } from "../server/account-feature-access";
export const Route = createFileRoute("/api/account/feature-access")({
  server: { handlers: { GET: ({ request }) => readAccountFeatureAccess(request, import.meta.env.VITE_ARKNIGHTS_ORIGIN) } },
});
