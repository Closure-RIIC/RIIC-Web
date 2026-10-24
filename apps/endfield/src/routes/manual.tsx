import { createFileRoute } from "@tanstack/react-router";
import { ManualPage } from "../components/ManualPage";
export const Route = createFileRoute("/manual")({
  validateSearch: (search: Record<string, unknown>): { view?: "simulation" } => ({
    view: search.view === "simulation" ? "simulation" : undefined,
  }),
  component: ManualPage,
});
