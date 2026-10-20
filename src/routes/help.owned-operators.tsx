import { createFileRoute, redirect } from "@tanstack/react-router";
import { legacyIssueDestination } from "@/docs/legacy-help";
export const Route = createFileRoute("/help/owned-operators")({
  validateSearch: (search: Record<string, unknown>): Partial<Record<"issue", string>> => ({ issue: typeof search.issue === "string" ? search.issue : undefined }),
  beforeLoad: ({ search }) => { throw redirect({ to: "/docs/$slug", params: { slug: legacyIssueDestination(search.issue) }, statusCode: 301, replace: true }); },
});
