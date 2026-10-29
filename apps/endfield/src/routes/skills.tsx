import { withMessages } from "../i18n/features-client";
import { createFileRoute } from "@tanstack/react-router";
import { RosterPage } from "../components/RosterPage";
const TranslatedRouteComponent = withMessages(() => <RosterPage skillsOnly />, "apps/endfield/src/routes/skills.tsx");

export const Route = createFileRoute("/skills")({ component: TranslatedRouteComponent });
