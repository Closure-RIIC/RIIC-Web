import type { MessageTranslator } from "./i18n/types";

const feedbackMessages = {
  "SklandErrors.sessionExpired": (t: MessageTranslator) => t("SklandErrors.sessionExpired"),
  "SklandErrors.invalidOrigin": (t: MessageTranslator) => t("SklandErrors.invalidOrigin"),
  "SklandErrors.unavailable": (t: MessageTranslator) => t("SklandErrors.unavailable"),
  "SklandErrors.accountLimit": (t: MessageTranslator) => t("SklandErrors.accountLimit"),
  "SklandErrors.consentRequired": (t: MessageTranslator) => t("SklandErrors.consentRequired"),
  "SklandErrors.accountBound": (t: MessageTranslator) => t("SklandErrors.accountBound"),
  "SklandErrors.notAvailable": (t: MessageTranslator) => t("SklandErrors.notAvailable"),
  "SklandErrors.signInRequired": (t: MessageTranslator) => t("SklandErrors.signInRequired"),
  "SklandErrors.forbidden": (t: MessageTranslator) => t("SklandErrors.forbidden"),
  "SklandErrors.invalidCredential": (t: MessageTranslator) => t("SklandErrors.invalidCredential"),
  "SklandErrors.invalidRequest": (t: MessageTranslator) => t("SklandErrors.invalidRequest"),
  "SklandErrors.tooLarge": (t: MessageTranslator) => t("SklandErrors.tooLarge"),
  "SklandErrors.invalidData": (t: MessageTranslator) => t("SklandErrors.invalidData"),
  "SklandErrors.rateLimited": (t: MessageTranslator) => t("SklandErrors.rateLimited"),
  "SklandErrors.roleMismatch": (t: MessageTranslator) => t("SklandErrors.roleMismatch"),
  "RestoreAccountButton.syncAnAccountFromSklandFirst": (t: MessageTranslator) => t("RestoreAccountButton.syncAnAccountFromSklandFirst"),
  "RestoreAccountButton.theOriginalAccountAuthorizationExpiredReauthorizeOnTheSkland": (t: MessageTranslator) => t("RestoreAccountButton.theOriginalAccountAuthorizationExpiredReauthorizeOnTheSkland"),
  "RestoreAccountButton.sklandDidNotReturnTheFullRosterSoOwnership": (t: MessageTranslator) => t("RestoreAccountButton.sklandDidNotReturnTheFullRosterSoOwnership"),
  "RestoreAccountButton.theAccountChangedRetry": (t: MessageTranslator) => t("RestoreAccountButton.theAccountChangedRetry"),
  "RestoreAccountButton.accountDataCannotBeRestoredLocalSettingsWereKept": (t: MessageTranslator) => t("RestoreAccountButton.accountDataCannotBeRestoredLocalSettingsWereKept"),
  "RestoreAccountButton.restoredYourActualOperatorsSkillsAndFacilityLevels": (t: MessageTranslator) => t("RestoreAccountButton.restoredYourActualOperatorsSkillsAndFacilityLevels"),
  "RestoreAccountButton.restoredYourActualOperatorsAndSkillsSklandFacilityData": (t: MessageTranslator) => t("RestoreAccountButton.restoredYourActualOperatorsAndSkillsSklandFacilityData"),
  "RestoreAccountButton.restoreFailedRetry": (t: MessageTranslator) => t("RestoreAccountButton.restoreFailedRetry"),
  "SklandLoginPanel.signInFailedPleaseRetry": (t: MessageTranslator) => t("SklandLoginPanel.signInFailedPleaseRetry"),
  "SklandLoginPanel.pollFailed": (t: MessageTranslator) => t("SklandLoginPanel.pollFailed"),
  "SklandLoginPanel.copyFailedSelectAndCopyTheCommandManually": (t: MessageTranslator) => t("SklandLoginPanel.copyFailedSelectAndCopyTheCommandManually"),
  "Skland.syncFailedPleaseRetry": (t: MessageTranslator) => t("Skland.syncFailedPleaseRetry"),
};
export type SklandFeedbackKey = keyof typeof feedbackMessages;
export function sklandFeedbackText(key: SklandFeedbackKey, t: MessageTranslator): string {
  return feedbackMessages[key](t);
}
