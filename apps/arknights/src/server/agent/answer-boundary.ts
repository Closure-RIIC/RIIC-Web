import { wrapLanguageModel } from "ai";
import type { LanguageModelV4, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { INTERNAL_ANSWER_MARKERS } from "../../agent-answer.ts";

/** A model step can contain narration followed by tools. Only terminal answer text is public. */
export function withAgentAnswerBoundary(model: LanguageModelV4, delivered?: () => Promise<void>) {
  return wrapLanguageModel({ model, middleware: {
    specificationVersion: "v4",
    wrapStream: async ({ doStream }) => {
      const result = await doStream();
      let text: LanguageModelV4StreamPart[] = [];
      let length = 0;
      let hasTools = false;
      let blocked = false;
      return { ...result, stream: result.stream.pipeThrough(new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
        async transform(part, output) {
          if (blocked && part.type !== "finish") return;
          if (part.type === "tool-call" || part.type === "tool-input-start") { hasTools = true; text = []; }
          if (part.type === "text-start" || part.type === "text-delta" || part.type === "text-end") {
            if (part.type === "text-delta") length += part.delta.length;
            if (length > 64_000) { blocked = true; text = []; output.enqueue({ type: "error", error: new Error("Agent answer exceeds limit") }); return; }
            if (!hasTools) text.push(part);
            return;
          }
          if (part.type === "error") text = [];
          if (part.type === "finish") {
            if (!hasTools && part.finishReason.unified !== "tool-calls") {
              const answer = text.map(item => item.type === "text-delta" ? item.delta : "").join("");
              if (INTERNAL_ANSWER_MARKERS.test(answer)) { blocked = true; output.enqueue({ type: "error", error: new Error("Agent answer contains internal protocol") }); }
              if (!blocked) {
                if (answer.trim()) await delivered?.();
                for (const item of text) output.enqueue(item);
              }
            }
            text = [];
          }
          output.enqueue(blocked && part.type === "finish" ? { ...part, finishReason: { unified: "error", raw: "answer_rejected" } } : part);
        },
        // An interrupted step must not release incomplete or unverified text.
        flush() { text = []; },
      })) };
    },
  } });
}
