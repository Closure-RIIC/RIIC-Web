export const AGENT_PAGE_CONTEXT_LIMIT = 24_000;

export interface AgentPageContext {
  version: 1;
  page: "calculator" | "manual" | "account-health" | "training-planner";
  title: string;
  summary: string;
}

export function sameAgentPageContext(left: AgentPageContext | null, right: AgentPageContext | null): boolean {
  return left === right || Boolean(left && right && left.version === right.version
    && left.page === right.page && left.title === right.title && left.summary === right.summary);
}
