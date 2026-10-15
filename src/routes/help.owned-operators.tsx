import { withPageScrollbars } from "@/components/ui/page-scrollbar-boundary";
import { createFileRoute } from "@tanstack/react-router";
import Page from "@/app/help/owned-operators/page";
import { pageHead } from "@/i18n/metadata";
export const Route = createFileRoute("/help/owned-operators")({
  validateSearch: (search: Record<string, unknown>): Partial<Record<"issue", string>> => ({ issue: typeof search.issue === "string" ? search.issue : undefined }),
  head: ({ matches }) => pageHead(matches[0].context.messages, "help_owned_operators"),
  component: withPageScrollbars(Page),
});
