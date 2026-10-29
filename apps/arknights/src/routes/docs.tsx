import { withMessages } from "@/i18n/features-client";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { DocsLayout } from "@/components/docs/DocsLayout";

const TranslatedRouteComponent = withMessages(() => <DocsLayout><Outlet /></DocsLayout>, "apps/arknights/src/routes/docs.tsx");

export const Route = createFileRoute("/docs")({
  component: TranslatedRouteComponent,
});
