import type { UIMessage, UIMessageChunk } from "ai";
import { ConversationStore, conversationStorageEnabled, type ArchiveStatus } from "./conversation-store.ts";
import { PublicApiError } from "@riic/platform-server/api-contract";

/** Owns one attempt; billing remains owned by the existing direct/gateway callbacks. */
export class ConversationRecorder {
  private store: ConversationStore;
  private id: string;
  private signal: AbortSignal;
  constructor(store: ConversationStore, id: string, signal: AbortSignal) { this.store = store; this.id = id; this.signal = signal; }

  async fail() {
    try { await this.store.checkpoint(this.id, null, "failed"); }
    catch { console.error(JSON.stringify({ event: "agent_archive_write_failed", turnId: this.id })); }
  }

  wrap(source: ReadableStream<UIMessageChunk>, runId?: string): ReadableStream<UIMessageChunk> {
    const { store, id, signal } = this;
    let disconnected = false;
    return new ReadableStream<UIMessageChunk>({
      async start(output) {
        let response: UIMessage | null = null;
        let failed = false;
        let status: ArchiveStatus = "interrupted";
        let finish: UIMessageChunk | undefined;
        let finishReason: string | undefined;
        let lastSave = 0;
        const send = (chunk: UIMessageChunk) => { if (!disconnected) output.enqueue(chunk); };
        try {
          const { readUIMessageStream } = await import("ai");
          const [wire, snapshots] = source.tee();
          const observe = (async () => {
            try {
              for await (const message of readUIMessageStream({ stream: snapshots, onError: () => {} })) {
                // SDK snapshots mutate as more chunks arrive. Persist only copies made by the store.
                response = message;
                if (Date.now() - lastSave >= 1000) {
                  lastSave = Date.now();
                  try { await store.checkpoint(id, response, "streaming", runId); }
                  catch { failed = true; }
                }
              }
            } catch { failed = true; }
          })();
          try {
            const reader = wire.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value.type === "error") status = "failed";
              if (value.type === "abort" && status !== "failed") status = "cancelled";
              if (value.type === "finish") {
                finish = value;
                finishReason = value.finishReason;
                if (status !== "failed" && status !== "cancelled") status = value.finishReason === "error" ? "failed" : "completed";
              } else send(value);
            }
          } catch {
            status = "failed";
            send({ type: "error", errorText: "回复传输中断，已保留成功接收的部分，请稍后重试。" });
          }
          await observe;
          if ((signal.aborted || disconnected) && status !== "failed") status = "cancelled";
          if (status === "interrupted") send({ type: "error", errorText: "回复传输中断，已保留成功接收的部分，请稍后重试。" });
          try { await store.checkpoint(id, response, status, runId, finishReason); }
          catch { failed = true; }
          if (failed) console.error(JSON.stringify({ event: "agent_archive_write_failed", turnId: id }));
          send({ type: "data-agent-archive", data: { status: failed ? "failed" : "saved", turnId: id } });
          if (finish) send(finish);
        } catch {
          try { await store.checkpoint(id, response, "failed", runId); } catch { /* Report through the UI below. */ }
          send({ type: "data-agent-archive", data: { status: "failed", turnId: id } });
          send({ type: "error", errorText: "会话归档处理失败，请稍后重试。" });
        } finally { if (!disconnected) output.close(); }
      },
      // Continue draining: existing model abort signals and billing finalizers still own cancellation.
      cancel() { disconnected = true; },
    });
  }
}

export async function beginConversationRecording(input: {
  userId: string; conversationId: unknown; attemptId: unknown; requestId: string; model: string;
  messages: UIMessage[]; signal: AbortSignal;
}): Promise<ConversationRecorder | undefined> {
  if (!conversationStorageEnabled()) return;
  const message = input.messages.at(-1);
  if (!message || message.role !== "user") throw new PublicApiError("AIC-REQ-1001", { message: "请发送新的问题后重试。" });
  const store = new ConversationStore();
  try {
    const turn = await store.begin({ ...input, message });
    return new ConversationRecorder(store, turn.id, input.signal);
  } catch (error) {
    if (error instanceof PublicApiError) throw error;
    throw new PublicApiError("AIC-SYS-5000", { message: "会话暂时无法保存，本次未调用模型，请稍后重试。" });
  }
}
