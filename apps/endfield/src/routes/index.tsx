import { withMessages } from "../i18n/features-client";
import { createFileRoute } from "@tanstack/react-router";
import { SchedulePage } from "../components/SchedulePage";
const TranslatedRouteComponent = withMessages(SchedulePage, "apps/endfield/src/routes/index.tsx");

export const Route = createFileRoute("/")({ component: TranslatedRouteComponent });
