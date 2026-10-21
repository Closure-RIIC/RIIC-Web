import type { Chat } from "@ai-sdk/react";
import type { ChatRequestOptions, UIMessage } from "ai";

export interface AgentRuntimeConversation {
  owner: string;
  chat: Chat<UIMessage>;
  requestOptions?: ChatRequestOptions;
  running: boolean;
  save: (id: string, messages: UIMessage[]) => void;
  savedMessages: UIMessage[];
}

/** Owns live requests independently of route/component lifetimes. */
export class AgentRuntime {
  private conversations = new Map<string, AgentRuntimeConversation>();
  private listeners = new Set<() => void>();
  private revision = 0;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.revision;
  getServerSnapshot = () => 0;
  private publish() { this.revision++; this.listeners.forEach((listener) => listener()); }

  getConversation(owner: string, id: string, messages: UIMessage[], save: AgentRuntimeConversation["save"], createChat: () => Chat<UIMessage>) {
    const key = `${owner}:${id}`;
    let entry = this.conversations.get(key);
    if (!entry) {
      // The route supplies the SDK instance so other pages do not load the chat SDK.
      entry = { owner, chat: createChat(), running: false, save, savedMessages: messages };
      this.conversations.set(key, entry);
    }
    // Keep the active entry most recent; retain all in-flight work during eviction.
    this.conversations.delete(key);
    this.conversations.set(key, entry);
    for (const [oldKey, old] of this.conversations) {
      if (this.conversations.size <= 5) break;
      if (old !== entry && !old.running) this.conversations.delete(oldKey);
    }
    return entry;
  }

  runningConversationIds(owner: string | null) {
    return [...this.conversations.values()].filter((entry) => entry.owner === owner && entry.running).map((entry) => entry.chat.id);
  }

  setRequestOptions(entry: AgentRuntimeConversation, options: ChatRequestOptions | undefined) {
    entry.requestOptions = options;
  }

  private checkpoint(entry: AgentRuntimeConversation) {
    if (entry.savedMessages === entry.chat.messages) return;
    entry.save(entry.chat.id, entry.chat.messages);
    entry.savedMessages = entry.chat.messages;
  }

  async run(entry: AgentRuntimeConversation, action: () => Promise<void>) {
    if (entry.running) return;
    entry.running = true;
    this.publish();
    const timer = setInterval(() => this.checkpoint(entry), 750);
    try {
      const pending = action();
      this.checkpoint(entry);
      await pending;
    } finally {
      clearInterval(timer);
      this.checkpoint(entry);
      entry.running = false;
      this.publish();
    }
  }

  flush = () => { this.conversations.forEach((entry) => this.checkpoint(entry)); };

  // Navigation keeps requests alive; changing accounts must not do so.
  activateOwner(owner: string | null) {
    for (const [key, entry] of this.conversations) {
      if (entry.owner === owner) continue;
      this.checkpoint(entry);
      void entry.chat.stop();
      this.conversations.delete(key);
    }
    this.publish();
  }

  dispose = () => {
    this.flush();
    this.conversations.forEach((entry) => { void entry.chat.stop(); });
  };
}
