import { withMessages } from "../i18n/features-client";
import { createFileRoute } from "@tanstack/react-router";
import { ChangelogPage } from "../components/ChangelogPage";

const TranslatedRouteComponent = withMessages(ChangelogPage, "apps/endfield/src/routes/changelog.tsx");

export const Route = createFileRoute("/changelog")({ component: TranslatedRouteComponent });
