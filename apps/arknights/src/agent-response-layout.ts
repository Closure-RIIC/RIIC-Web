import type { UIMessage } from "ai";
import type { AgentPersona, BuiltinAgentPersona } from "./agent-personas.ts";
import { parsePersonaAvatar } from "./agent-persona-avatar.ts";

export type AgentReplyPersona = { mode?: "pure"; name?: string; avatarUrl?: string; mascot?: BuiltinAgentPersona["avatar"] };

/** Save presentation with the question, independently of the browser's next selection. */
export function snapshotAgentReplyPersona(persona: AgentPersona | null, mode?: "pure"): AgentReplyPersona {
  if (mode === "pure") return { mode };
  return persona ? {
    name: persona.name,
    ...(persona.kind === "builtin" ? { mascot: persona.avatar } : { avatarUrl: persona.avatarUrl }),
  } : {};
}

export function readAgentReplyPersona(metadata: unknown): AgentReplyPersona {
  const raw = (metadata as { replyPersona?: AgentReplyPersona } | null)?.replyPersona;
  if (!raw || typeof raw !== "object") return {};
  if (raw.mode === "pure") return { mode: "pure" };
  return {
    name: typeof raw.name === "string" ? raw.name.slice(0, 40) : undefined,
    avatarUrl: parsePersonaAvatar(raw.avatarUrl),
    mascot: ["silverash", "exusiai", "saileach", "mountain"].includes(raw.mascot ?? "") ? raw.mascot : undefined,
  };
}

export type AgentDisplayTurn =
  | { kind: "user"; key: string; message: UIMessage }
  | { kind: "response"; key: string; messages: UIMessage[]; pending: boolean; persona: AgentReplyPersona };

export function hasVisibleAgentPart(part: UIMessage["parts"][number], active: boolean): boolean {
  if (part.type === "text") return Boolean(part.text.trim());
  if (part.type === "reasoning") return Boolean(part.text.trim()) || (active && part.state === "streaming");
  return part.type.startsWith("tool-");
}

export function hasActiveAgentContent(message: UIMessage | undefined): boolean {
  return Boolean(message?.parts.some((part) => {
    if (part.type === "text") return part.state === "streaming" && Boolean(part.text.trim());
    if (part.type === "reasoning") return part.state === "streaming";
    return part.type.startsWith("tool-") && "state" in part && (part.state === "input-streaming" || part.state === "input-available");
  }));
}

/** A response keeps the user's stable key before and after the SDK assigns an assistant ID. */
export function buildAgentDisplayTurns(messages: UIMessage[], busy: boolean): AgentDisplayTurn[] {
  const turns: AgentDisplayTurn[] = [];
  let response: Extract<AgentDisplayTurn, { kind: "response" }> | undefined;
  for (const message of messages) {
    if (message.role === "user") {
      turns.push({ kind: "user", key: message.id, message });
      response = { kind: "response", key: `response:${message.id}`, messages: [], pending: false, persona: readAgentReplyPersona(message.metadata) };
      turns.push(response);
    } else if (message.role === "assistant") {
      if (!response) {
        response = { kind: "response", key: `response:${message.id}`, messages: [], pending: false, persona: readAgentReplyPersona(message.metadata) };
        turns.push(response);
      }
      response.messages.push(message);
    }
  }
  if (busy && response) response.pending = true;
  return turns.filter((turn) => turn.kind === "user" || turn.pending || turn.messages.some((message) => message.parts.some((part) => hasVisibleAgentPart(part, false))));
}
