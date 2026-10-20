export const AGENT_TIMEOUT_ERROR = "AGENT_RESPONSE_TIMEOUT";
export const AGENT_UNAVAILABLE_ERROR = "AGENT_SERVICE_UNAVAILABLE";
export const AGENT_INTERRUPTED_ERROR = "AGENT_RESPONSE_INTERRUPTED";

export function agentChatErrorMessage(message: string, en: boolean): string {
  if (message === AGENT_TIMEOUT_ERROR) {
    return en
      ? "The model response timed out. You can retry your last question; your question and attachments are still here."
      : "模型响应超时，请稍后重试。你的问题和附件仍保留在对话中。";
  }
  if (message === AGENT_INTERRUPTED_ERROR) {
    return en ? "The reply was interrupted. The received text is preserved; you can retry your question."
      : "回答中途断开，已收到的内容仍然保留，可以重试这条问题。";
  }
  if (message === AGENT_UNAVAILABLE_ERROR) {
    return en ? "The assistant is temporarily unavailable. Please try again shortly or choose another model."
      : "助理服务暂时不可用，请稍后重试或切换模型。";
  }
  return message;
}
