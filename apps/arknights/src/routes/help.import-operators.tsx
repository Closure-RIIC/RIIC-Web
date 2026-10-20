import { createFileRoute, redirect } from "@tanstack/react-router";
import { legacyImportDestination } from "@/docs/legacy-help";
export const Route = createFileRoute("/help/import-operators")({
  validateSearch: (search: Record<string, unknown>): { step?: string | number; source?: string } => ({ step: typeof search.step === "string" || typeof search.step === "number" ? search.step : undefined, source: typeof search.source === "string" ? search.source : undefined }),
  beforeLoad: ({ search }) => {
    const { slug, source, hash } = legacyImportDestination(search);
    throw redirect({ to: "/docs/$slug", params: { slug }, search: { source }, hash, statusCode: 301, replace: true });
  },
});
