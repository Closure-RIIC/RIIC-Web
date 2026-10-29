import { withMessages } from "../i18n/features-client";
import { createFileRoute } from "@tanstack/react-router";
import { SklandPage } from "../components/SklandPage";

const TranslatedRouteComponent = withMessages(SklandPage, "apps/endfield/src/routes/skland.tsx");

export const Route = createFileRoute("/skland")({ component: TranslatedRouteComponent });
