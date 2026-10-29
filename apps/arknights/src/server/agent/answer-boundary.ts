import { wrapLanguageModel } from "ai";
import type { LanguageModelV4, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { INTERNAL_ANSWER_MARKERS } from "../../agent-answer.ts";

// Keep only suffixes that could still become one of INTERNAL_ANSWER_MARKERS.
// JSON whitespace and tool names are variable length, so a fixed tail is not enough.
const MARKER_PREFIXES = [
  "[客户端提供的历史工具结果", "[system]", "[[system]",
  "<|im_start|>", "<|im_end|>", "<|start_header_id|>", "<|end_header_id|>", "<|eot_id|>",
  '"toolcallid"', '"tool_call_id"', '"type"',
];

function safeTextLength(text: string) {
  // Fold only ASCII: Unicode lowercasing can change the string length (e.g. İ),
  // which would make marker offsets point into the wrong part of the source.
  const lower = text.replace(/[A-Z]/g, char => char.toLowerCase());
  for (const match of lower.matchAll(/[[<"]/g)) {
    const suffix = lower.slice(match.index);
    if (MARKER_PREFIXES.some(marker => marker.startsWith(suffix))
      || /^"(?:toolcallid|tool_call_id)"\s*$/.test(suffix)
      || /^"type"\s*(?::\s*)?$/.test(suffix)) return match.index;
    const value = /^"type"\s*:\s*"([^"]*)$/.exec(suffix)?.[1];
    if (value !== undefined && ("tool-".startsWith(value) || value.startsWith("tool-"))) return match.index;
  }
  // A provider may split a UTF-16 surrogate pair between deltas.
  return /[\uD800-\uDBFF]$/.test(text) ? text.length - 1 : text.length;
}

type TextPart = Extract<LanguageModelV4StreamPart, { type: "text-start" | "text-delta" | "text-end" }>;

/** Stream safe text while holding potential protocol markers across deltas. */
export function withAgentAnswerBoundary(model: LanguageModelV4, delivered?: () => Promise<void>) {
  let deliveryMarked = false;
  return wrapLanguageModel({ model, middleware: {
    specificationVersion: "v4",
    wrapStream: async ({ doStream }) => {
      const result = await doStream();
      let text: TextPart[] = [];
      let pending = "";
      let length = 0;
      let hasTools = false;
      let blocked = false;
      const openText = new Set<string>();
      const discard = (output: TransformStreamDefaultController<LanguageModelV4StreamPart>) => {
        text = []; pending = "";
        for (const id of openText) output.enqueue({ type: "text-end", id });
        openText.clear();
      };
      const emit = async (count: number, output: TransformStreamDefaultController<LanguageModelV4StreamPart>) => {
        let consumed = 0;
        for (const part of text) {
          if (part.type === "text-delta") {
            if (!count) break;
            const delta = part.delta.slice(0, count);
            if (delta.trim() && !deliveryMarked) { await delivered?.(); deliveryMarked = true; }
            output.enqueue({ ...part, delta });
            pending = pending.slice(delta.length);
            count -= delta.length;
            if (delta.length < part.delta.length) {
              text[consumed] = { ...part, delta: part.delta.slice(delta.length) };
              break;
            }
          } else {
            if (part.type === "text-start") openText.add(part.id);
            else openText.delete(part.id);
            output.enqueue(part);
          }
          consumed++;
        }
        text = text.slice(consumed);
      };
      return { ...result, stream: result.stream.pipeThrough(new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
        async transform(part, output) {
          if (blocked && part.type !== "finish") return;
          // Text already sent before a tool call cannot be retracted. Once a tool
          // starts, discard any held prefix and suppress the rest of its narration.
          if (part.type === "tool-call" || part.type === "tool-input-start") { hasTools = true; discard(output); }
          if (part.type === "text-start" || part.type === "text-delta" || part.type === "text-end") {
            if (hasTools) return;
            if (part.type === "text-delta") length += part.delta.length;
            if (length > 64_000) { blocked = true; discard(output); output.enqueue({ type: "error", error: new Error("Agent answer exceeds limit") }); return; }
            text.push(part);
            if (part.type === "text-delta") pending += part.delta;
            if (INTERNAL_ANSWER_MARKERS.test(pending)) {
              blocked = true; discard(output); output.enqueue({ type: "error", error: new Error("Agent answer contains internal protocol") }); return;
            }
            await emit(safeTextLength(pending), output);
            return;
          }
          if (part.type === "error") { blocked = true; discard(output); }
          if (part.type === "finish") {
            if (!blocked && !hasTools && part.finishReason.unified === "stop") await emit(pending.length, output);
            discard(output);
          }
          output.enqueue(blocked && part.type === "finish" ? { ...part, finishReason: { unified: "error", raw: "answer_rejected" } } : part);
        },
        // Keep text already delivered on interruption, but drop unresolved prefixes.
        flush(output) { discard(output); },
      })) };
    },
  } });
}
