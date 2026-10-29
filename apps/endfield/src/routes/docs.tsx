import { withMessages } from "../i18n/features-client";
import { createFileRoute } from "@tanstack/react-router";
import { DocsPage } from "../components/DocsPage";
const TranslatedRouteComponent = withMessages(DocsPage, "apps/endfield/src/routes/docs.tsx");

export const Route = createFileRoute("/docs")({ component: TranslatedRouteComponent });
