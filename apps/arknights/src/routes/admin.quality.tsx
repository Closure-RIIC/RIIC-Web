import { withMessages } from "@/i18n/features-client";
import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/admin/quality/page";
import { pageHead } from "@/i18n/metadata";
const TranslatedRouteComponent = withMessages(withPageScrollbars(Page), "apps/arknights/src/routes/admin.quality.tsx");

export const Route = createFileRoute("/admin/quality")({
  validateSearch: (search: Record<string, unknown>): Partial<Record<"draft" | "drafts", string>> => ({ draft: typeof search.draft === "string" ? search.draft : undefined, drafts: typeof search.drafts === "string" ? search.drafts : undefined }),
  head: ({ matches }) => pageHead(matches, "admin_issues"),
  component: TranslatedRouteComponent,
});
