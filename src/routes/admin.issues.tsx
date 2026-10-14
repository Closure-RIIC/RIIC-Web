import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/i18n/metadata";
import { AdminIssues } from "@/app/admin/issues/issues-client";
export const Route = createFileRoute("/admin/issues")({
  validateSearch: (search: Record<string, unknown>): Partial<Record<"q" | "status" | "facility" | "offset" | "from" | "to" | "errorCode" | "solver", string>> => ({ q: typeof search.q === "string" ? search.q : undefined, status: typeof search.status === "string" ? search.status : undefined, facility: typeof search.facility === "string" ? search.facility : undefined, offset: typeof search.offset === "string" ? search.offset : undefined, from: typeof search.from === "string" ? search.from : undefined, to: typeof search.to === "string" ? search.to : undefined, errorCode: typeof search.errorCode === "string" ? search.errorCode : undefined, solver: typeof search.solver === "string" ? search.solver : undefined }),
  head: ({ matches }) => pageHead(matches[0].context.messages, "admin_issues"),
  component: withPageScrollbars(IssuesPage),

});
function IssuesPage() { return <AdminIssues isAdmin={Route.useRouteContext().isAdmin} />; }
