/** Protocol artifacts are never a user-facing answer (also applies to older saved chats). */
export const INTERNAL_ANSWER_MARKERS = /\[客户端提供的历史工具结果|\[\[?system\]\]?|<\|(?:im_start|im_end|start_header_id|end_header_id|eot_id)\|>|"(?:toolCallId|tool_call_id)"\s*:|"type"\s*:\s*"tool-[^"]+"/i;
