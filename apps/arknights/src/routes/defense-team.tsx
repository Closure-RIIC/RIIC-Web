import { createFileRoute } from "@tanstack/react-router";
import { DefenseTeamPage } from "../components/pages/DefenseTeamPage";
import { withPageScrollbars } from "../components/ui/page-scrollbar-boundary";
export const Route = createFileRoute("/defense-team")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { code?: string; server?: "official" | "bilibili" } => ({
    code:
      typeof search.code === "string" && search.code.trim().length <= 64
        ? search.code.trim()
        : undefined,
    server:
      search.server === "official" || search.server === "bilibili"
        ? search.server
        : undefined,
  }),
  component: withPageScrollbars(DefenseTeamPage),
});
