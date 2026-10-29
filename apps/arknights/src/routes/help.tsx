import { withMessages } from "@/i18n/features-client";
import { createFileRoute, Outlet } from "@tanstack/react-router";
const TranslatedRouteComponent = withMessages(Outlet, "apps/arknights/src/routes/help.tsx");

export const Route = createFileRoute("/help")({ component: TranslatedRouteComponent });
