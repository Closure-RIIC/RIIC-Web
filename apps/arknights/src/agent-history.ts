import type { UIMessage } from "ai";

export const AGENT_HISTORY_LIMIT = 5;

export interface AgentConversation {
  id: string;
  title: string;
  updatedAt: number;
  messages: UIMessage[];
}

export interface AgentHistory {
  version: 1;
  conversations: AgentConversation[];
  activeId: string;
  expanded: boolean;
}

export function emptyAgentHistory(): AgentHistory {
  return { version: 1, conversations: [], activeId: "", expanded: true };
}

/** Finish partial stream states before a saved conversation is sent back to the SDK. */
export function restoreAgentMessages(messages: UIMessage[]): UIMessage[] {
  return structuredClone(messages).map((message) => ({
    ...message,
    parts: message.parts.flatMap<UIMessage["parts"][number]>((part) => {
      if (part.type === "text" || part.type === "reasoning") return [{ ...part, state: "done" as const }];
      if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
        const tool = part as typeof part & { state: string };
        if (tool.state === "input-streaming") return [];
        if (tool.state === "input-available") return [{ ...tool, state: "output-error", errorText: "上次回复已中断，请重新提问。" } as typeof part];
      }
      return [part];
    }),
  })).filter((message) => message.parts.length > 0);
}

export function updateAgentConversation(history: AgentHistory, id: string, messages: UIMessage[], now = Date.now()): AgentHistory {
  const firstUser = messages.find((message) => message.role === "user");
  if (!firstUser) return history;
  const title = firstUser.parts.filter((part) => part.type === "text").map((part) => part.text).join(" ").replace(/\s+/g, " ").trim()
    || firstUser.parts.find((part) => part.type === "file")?.filename || "…";
  const conversation: AgentConversation = { id, title: [...title].slice(0, 40).join(""), updatedAt: now, messages: structuredClone(messages) };
  return {
    ...history,
    conversations: [conversation, ...history.conversations.filter((entry) => entry.id !== id)]
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, AGENT_HISTORY_LIMIT),
  };
}

export function parseAgentHistory(value: unknown): AgentHistory {
  if (!value || typeof value !== "object") return emptyAgentHistory();
  const raw = value as Partial<AgentHistory>;
  if (raw.version !== 1 || !Array.isArray(raw.conversations)) return emptyAgentHistory();
  const ids = new Set<string>();
  const conversations = raw.conversations.filter((entry) => {
    if (!entry || typeof entry.id !== "string" || !entry.id || ids.has(entry.id)
      || typeof entry.title !== "string" || !Number.isFinite(entry.updatedAt) || !Array.isArray(entry.messages)) return false;
    if (!entry.messages.length || !entry.messages.every((message) => message && typeof message.id === "string"
      && ["user", "assistant"].includes(message.role) && Array.isArray(message.parts)
      && message.parts.every((part) => part && typeof part.type === "string"
        && (!(part.type === "text" || part.type === "reasoning") || typeof part.text === "string")
        && (part.type !== "file" || (typeof part.url === "string" && typeof part.mediaType === "string"))))) return false;
    ids.add(entry.id);
    return true;
  }).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, AGENT_HISTORY_LIMIT);
  return { version: 1, conversations, activeId: typeof raw.activeId === "string" ? raw.activeId : "", expanded: raw.expanded !== false };
}

export function mergeAgentHistories(stored: AgentHistory, incoming: AgentHistory): AgentHistory {
  const conversations = new Map(stored.conversations.map((entry) => [entry.id, entry]));
  for (const entry of incoming.conversations) {
    const previous = conversations.get(entry.id);
    if (!previous || entry.updatedAt >= previous.updatedAt) conversations.set(entry.id, entry);
  }
  return { ...incoming, conversations: [...conversations.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, AGENT_HISTORY_LIMIT) };
}
