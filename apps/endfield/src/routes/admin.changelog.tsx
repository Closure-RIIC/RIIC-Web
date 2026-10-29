import { createFileRoute } from "@tanstack/react-router";
import { withMessages } from "../i18n/features-client";
import { ChangelogAdminPage } from "../components/ChangelogAdminPage";

const TranslatedRouteComponent = withMessages(ChangelogAdminPage, "apps/endfield/src/routes/admin.changelog.tsx");
export const Route = createFileRoute("/admin/changelog")({ component: TranslatedRouteComponent });
