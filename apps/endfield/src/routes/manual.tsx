import { withMessages } from "../i18n/features-client";
import { createFileRoute } from "@tanstack/react-router";
import { ManualPage } from "../components/ManualPage";
const TranslatedRouteComponent = withMessages(ManualPage, "apps/endfield/src/routes/manual.tsx");

export const Route = createFileRoute("/manual")({
  validateSearch: (search: Record<string, unknown>): { view?: "simulation" } => ({
    view: search.view === "simulation" ? "simulation" : undefined,
  }),
  component: TranslatedRouteComponent,
});
