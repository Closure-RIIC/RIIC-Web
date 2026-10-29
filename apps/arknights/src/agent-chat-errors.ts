import { createLocalizer as createUiLocalizer } from "@riic/arknights-domain/i18n/localize";
import type UiMessages from "../messages/zh-CN/AK_agent_chat_errors.json";
const uiText = createUiLocalizer<typeof UiMessages>("AK_agent_chat_errors");
import type { AppLocale } from "@riic/contracts/locale";
export const AGENT_TIMEOUT_ERROR = "AGENT_RESPONSE_TIMEOUT";
export const AGENT_UNAVAILABLE_ERROR = "AGENT_SERVICE_UNAVAILABLE";
export const AGENT_INTERRUPTED_ERROR = "AGENT_RESPONSE_INTERRUPTED";

export function agentChatErrorMessage(message: string, en: AppLocale): string {
  if (message === AGENT_TIMEOUT_ERROR) {
    return uiText.text(en, "theModelResponseTimedOutYouCanRetry");
  }
  if (message === AGENT_INTERRUPTED_ERROR) {
    return uiText.text(en, "theReplyWasInterruptedTheReceivedTextIs");
  }
  if (message === AGENT_UNAVAILABLE_ERROR) {
    return uiText.text(en, "theAssistantIsTemporarilyUnavailablePleaseTryAgain");
  }
  return message;
}
