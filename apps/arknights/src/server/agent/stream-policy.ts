import { wrapLanguageModel, type UIMessageChunk } from "ai";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { AGENT_INTERRUPTED_ERROR, AGENT_TIMEOUT_ERROR, AGENT_UNAVAILABLE_ERROR } from "../../agent-chat-errors.ts";

export const AGENT_STREAM_TIMEOUT = {
  firstChunkMs: 60_000,
  chunkMs: 60_000,
  totalMs: 10 * 60_000,
};

function isTimeout(error: unknown): boolean {
  for (let depth = 0; depth < 5 && error instanceof Error; depth++) {
    if (error.name === "TimeoutError") return true;
    error = error.cause;
  }
  return false;
}

// Guard each provider stream, not the whole SDK step: a step also includes
// potentially slow tool execution. Keepalives/metadata do not reset the timer.
export function withAgentModelTimeout(model: LanguageModelV4, timeout = AGENT_STREAM_TIMEOUT) {
  return wrapLanguageModel({ model, middleware: {
    specificationVersion: "v4",
    wrapStream: async ({ model, params }) => {
      const controller = new AbortController();
      const signal = params.abortSignal ? AbortSignal.any([params.abortSignal, controller.signal]) : controller.signal;
      let timer: ReturnType<typeof setTimeout>;
      const clear = () => { clearTimeout(timer); signal.removeEventListener("abort", clear); };
      const arm = (ms: number) => {
        clearTimeout(timer);
        timer = setTimeout(() => controller.abort(new DOMException("Model response timed out", "TimeoutError")), ms);
      };
      signal.addEventListener("abort", clear, { once: true });
      arm(timeout.firstChunkMs);
      try {
        const response = await model.doStream({ ...params, abortSignal: signal });
        const reader = response.stream.getReader();
        let terminal = false;
        let progressed = false;
        const streamError = (error: unknown) => progressed && !isTimeout(error) ? new Error(AGENT_INTERRUPTED_ERROR) : error;
        return { ...response, stream: new ReadableStream({
          async pull(output) {
            try {
              const { value, done } = await reader.read();
              if (done) {
                clear();
                if (!terminal && !signal.aborted) output.enqueue({ type: "error", error: new Error(AGENT_INTERRUPTED_ERROR) });
                output.close(); return;
              }
              if (value.type === "finish" || value.type === "error") { terminal = true; clear(); }
              else if (((value.type === "text-delta" || value.type === "reasoning-delta" || value.type === "tool-input-delta") && value.delta.length > 0) || value.type === "tool-call") { progressed = true; arm(timeout.chunkMs); }
              output.enqueue(value.type === "error" ? { ...value, error: streamError(value.error) } : value);
            } catch (error) {
              clear();
              output.enqueue({ type: "error", error: streamError(error) });
              output.close();
            }
          },
          cancel(reason) { clear(); controller.abort(reason); return reader.cancel(reason); },
        }) };
      } catch (error) { clear(); throw error; }
    },
  } });
}

export function createAgentStreamPolicy(signal: AbortSignal, timeout = AGENT_STREAM_TIMEOUT) {
  let timedOut = false;
  return {
    options: {
      abortSignal: signal,
      timeout: { totalMs: timeout.totalMs },
      // The SDK retries only failed request setup, never a partially consumed
      // stream or an already executed tool. Bound retries to transient failures.
      maxRetries: 2,
      // The route logs the sanitized UI-stream error with its request ID.
      // Suppress the SDK's default raw error/body dump to console.error.
      onError: () => {},
      onAbort: ({ reason }: { reason?: unknown }) => { timedOut = isTimeout(reason); },
    },
    errorText(error: unknown) {
      if (isTimeout(error)) return AGENT_TIMEOUT_ERROR;
      if (error instanceof Error && error.message === AGENT_INTERRUPTED_ERROR) return AGENT_INTERRUPTED_ERROR;
      return AGENT_UNAVAILABLE_ERROR;
    },
    // SDK timeouts are abort chunks, which useChat normally treats as a
    // successful stop. Convert only timeouts to errors so retry becomes visible.
    transform: new TransformStream<UIMessageChunk, UIMessageChunk>({
      transform(chunk, controller) {
        controller.enqueue(chunk.type === "abort" && timedOut
          ? { type: "error", errorText: AGENT_TIMEOUT_ERROR }
          : chunk);
      },
    }),
  };
}
