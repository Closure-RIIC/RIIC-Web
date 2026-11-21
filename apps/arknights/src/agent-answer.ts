/** Protocol artifacts are never a user-facing answer (also applies to older saved chats). */
export const INTERNAL_ANSWER_MARKERS = /\[客户端提供的历史工具结果|\[\[?system\]\]?|<\|(?:im_start|im_end|start_header_id|end_header_id|eot_id)\|>|"(?:toolCallId|tool_call_id)"\s*:|"type"\s*:\s*"tool-[^"]+"/i;

const THINK_TAGS = ["<think>", "</think>"];

/** Hold only a possible split tag, never the hidden text itself. */
export function createInlineThinkingFilter() {
  let depth = 0;
  let pending = "";
  return (delta: string) => {
    const text = pending + delta;
    let visible = "";
    let offset = 0;
    for (const tag of text.matchAll(/<\/?think>/gi)) {
      if (!depth) visible += text.slice(offset, tag.index);
      depth = tag[0][1] === "/" ? Math.max(0, depth - 1) : depth + 1;
      offset = tag.index + tag[0].length;
    }
    const tail = text.slice(offset);
    const start = tail.lastIndexOf("<");
    const suffix = start < 0 ? "" : tail.slice(start);
    pending = suffix && THINK_TAGS.some(tag => tag.startsWith(suffix.toLowerCase())) ? suffix : "";
    return depth ? visible : visible + tail.slice(0, tail.length - pending.length);
  };
}
