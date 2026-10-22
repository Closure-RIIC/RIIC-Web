export const LEGAL_EFFECTIVE_DATE = "2026-09-06";
export const PRIVACY_EFFECTIVE_DATE = "2026-09-06";
export const TERMS_VERSION = "2026-09-06-content-rights";
export const PRIVACY_VERSION = "2026-09-06-processing-clarification";
export const LEGAL_OFFICIAL_ACCOUNT_URL = "https://space.bilibili.com/3707051935009359";

export interface SklandPolicyConsentRequest {
  termsAccepted: true;
  privacyAccepted: true;
  termsVersion: typeof TERMS_VERSION;
  privacyVersion: typeof PRIVACY_VERSION;
}

export function isCurrentPolicyConsent(value: unknown): value is SklandPolicyConsentRequest {
  if (!value || typeof value !== "object") return false;
  const consent = value as Partial<SklandPolicyConsentRequest>;
  return consent.termsAccepted === true
    && consent.privacyAccepted === true
    && consent.termsVersion === TERMS_VERSION
    && consent.privacyVersion === PRIVACY_VERSION;
}
