"use client";

import { AgentChat } from "@/components/agent/AgentChat";
import { useWebsiteSession } from "@/website-session";
import { useAgentHistory } from "@/hooks/use-agent-history";
import { restoreAgentMessages } from "@/agent-history";
import { useFeatureAccess } from "./FeatureAccessProvider";

export function AgentRoute() {
  const { data, isPending } = useWebsiteSession();
  const { billing } = useFeatureAccess();
  const { ready, history } = useAgentHistory();
  if (isPending || !ready) return null;
  const conversation = history.conversations.find((entry) => entry.id === history.activeId);
  return <AgentChat key={`${data?.user.id ?? "anonymous"}:${history.activeId}`} billingAllowed={billing} userId={data?.user.id} userName={data?.user.name} conversationId={history.activeId} initialMessages={conversation ? restoreAgentMessages(conversation.messages) : []} />;
}
