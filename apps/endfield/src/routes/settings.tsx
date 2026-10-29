import { withMessages } from "../i18n/features-client";
import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "../components/SettingsPage";
const TranslatedRouteComponent = withMessages(SettingsPage, "apps/endfield/src/routes/settings.tsx");

export const Route = createFileRoute("/settings")({ component: TranslatedRouteComponent });
