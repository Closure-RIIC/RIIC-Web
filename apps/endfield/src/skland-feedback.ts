import { PlatformRequestError } from "@riic/platform/client";
import type { SklandFeedbackKey } from "./skland-feedback-text";
export type { SklandFeedbackKey } from "./skland-feedback-text";

/** Store a message key so feedback follows language changes without repeating requests. */
export class SklandFeedbackError extends Error {
  readonly messageKey: SklandFeedbackKey;
  constructor(messageKey: SklandFeedbackKey) { super(messageKey); this.messageKey = messageKey; }
}

const codeMessages: Readonly<Record<string, SklandFeedbackKey>> = {
  "AIC-AUTH-2001": "SklandErrors.sessionExpired",
  "AIC-AUTH-2002": "SklandErrors.invalidOrigin",
  "AIC-AUTH-2003": "SklandErrors.unavailable",
  "AIC-AUTH-2004": "SklandErrors.accountLimit",
  "AIC-AUTH-2005": "SklandErrors.consentRequired",
  "AIC-AUTH-2006": "SklandErrors.accountBound",
  "AIC-AUTH-2007": "SklandErrors.notAvailable",
  "AIC-AUTH-2008": "SklandErrors.signInRequired",
  "AIC-AUTH-2009": "SklandErrors.forbidden",
  "AIC-AUTH-2010": "SklandErrors.invalidCredential",
  "AIC-REQ-1001": "SklandErrors.invalidRequest",
  "AIC-REQ-1002": "SklandErrors.tooLarge",
  "AIC-BOX-1101": "SklandErrors.invalidData",
  "AIC-RATE-6001": "SklandErrors.rateLimited",
  "AIC-SYS-5000": "SklandErrors.unavailable",
};

export function sklandErrorKey(error: unknown, fallback: SklandFeedbackKey): SklandFeedbackKey {
  if (error instanceof SklandFeedbackError) return error.messageKey;
  if (!(error instanceof PlatformRequestError)) return fallback;
  if (error.code && Object.hasOwn(codeMessages, error.code)) return codeMessages[error.code];
  if (error.status === 401) return "SklandErrors.sessionExpired";
  if (error.status === 403) return "SklandErrors.forbidden";
  if (error.status === 413) return "SklandErrors.tooLarge";
  if (error.status === 429) return "SklandErrors.rateLimited";
  if (error.status >= 500) return "SklandErrors.unavailable";
  return fallback;
}
