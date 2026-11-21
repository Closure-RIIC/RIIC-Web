import type { UIMessage } from "ai";
import type { AgentModelId } from "./agent-models.ts";
import { createInlineThinkingFilter } from "./agent-answer.ts";

export const AGENT_HISTORY_LIMIT = 5;

export interface AgentConversationPreferences {
  selectedModel?: AgentModelId;
  imageMode?: "include" | "exclude";
}

export interface AgentConversation extends AgentConversationPreferences {
  id: string;
  title: string;
  updatedAt: number;
  messages: UIMessage[];
  preferencesUpdatedAt?: number;
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
  return structuredClone(messages).map((message) => {
    let stripThinking = createInlineThinkingFilter();
    return {
      ...message,
      parts: message.parts.flatMap<UIMessage["parts"][number]>((part) => {
        if (part.type === "step-start" || part.type.startsWith("tool-") || part.type === "dynamic-tool") {
          stripThinking = createInlineThinkingFilter();
        }
        if (message.role === "assistant" && part.type === "text") {
          const text = stripThinking(part.text);
          return text.trim() ? [{ ...part, text, state: "done" }] : [];
        }
        if (part.type === "text" || part.type === "reasoning") return [{ ...part, state: "done" as const }];
        if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
          const tool = part as typeof part & { state: string };
          if (tool.state === "input-streaming") return [];
          if (tool.state === "input-available") return [{ ...tool, state: "output-error", errorText: "上次回复已中断，请重新提问。" } as typeof part];
        }
        return [part];
      }),
    };
  }).filter((message) => message.parts.length > 0);
}

export function updateAgentConversation(history: AgentHistory, id: string, messages: UIMessage[], now = Date.now(), preferences?: AgentConversationPreferences, preferencesUpdatedAt = now): AgentHistory {
  const firstUser = messages.find((message) => message.role === "user");
  if (!firstUser) return history;
  const title = firstUser.parts.filter((part) => part.type === "text").map((part) => part.text).join(" ").replace(/\s+/g, " ").trim()
    || firstUser.parts.find((part) => part.type === "file")?.filename || "…";
  const previous = history.conversations.find((entry) => entry.id === id);
  const appliedPreferences = preferencesUpdatedAt >= (previous?.preferencesUpdatedAt ?? 0) ? preferences : undefined;
  const preferencesChanged = appliedPreferences && (appliedPreferences.selectedModel !== previous?.selectedModel || appliedPreferences.imageMode !== previous?.imageMode);
  const conversation: AgentConversation = { selectedModel: previous?.selectedModel, imageMode: previous?.imageMode, ...appliedPreferences,
    preferencesUpdatedAt: preferencesChanged ? preferencesUpdatedAt : previous?.preferencesUpdatedAt,
    id, title: [...title].slice(0, 40).join(""), updatedAt: now, messages: structuredClone(messages) };
  return {
    ...history,
    conversations: [conversation, ...history.conversations.filter((entry) => entry.id !== id)]
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, AGENT_HISTORY_LIMIT),
  };
}

/** A preference change must preserve the last message checkpoint. */
export function updateAgentConversationPreferences(history: AgentHistory, id: string, preferences: AgentConversationPreferences, now = Date.now()): AgentHistory {
  if (!history.conversations.some((entry) => entry.id === id)) return history;
  return { ...history, conversations: history.conversations.map((entry) => entry.id === id ? { ...entry, ...preferences, preferencesUpdatedAt: now } : entry) };
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
  }).map((entry) => ({ ...entry,
    selectedModel: entry.selectedModel === "deepseek" || entry.selectedModel === "glm" || entry.selectedModel === "gpt" ? entry.selectedModel : undefined,
    imageMode: entry.imageMode === "exclude" ? "exclude" as const : "include" as const,
    preferencesUpdatedAt: Number.isFinite(entry.preferencesUpdatedAt) ? entry.preferencesUpdatedAt : undefined,
  })).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, AGENT_HISTORY_LIMIT);
  return { version: 1, conversations, activeId: typeof raw.activeId === "string" ? raw.activeId : "", expanded: raw.expanded !== false };
}

export function mergeAgentHistories(stored: AgentHistory, incoming: AgentHistory): AgentHistory {
  const conversations = new Map(stored.conversations.map((entry) => [entry.id, entry]));
  for (const entry of incoming.conversations) {
    const previous = conversations.get(entry.id);
    if (!previous) { conversations.set(entry.id, entry); continue; }
    const latestMessages = entry.updatedAt >= previous.updatedAt ? entry : previous;
    const latestPreferences = (entry.preferencesUpdatedAt ?? 0) >= (previous.preferencesUpdatedAt ?? 0) ? entry : previous;
    conversations.set(entry.id, { ...latestMessages, selectedModel: latestPreferences.selectedModel,
      imageMode: latestPreferences.imageMode, preferencesUpdatedAt: latestPreferences.preferencesUpdatedAt });
  }
  return { ...incoming, conversations: [...conversations.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, AGENT_HISTORY_LIMIT) };
}
