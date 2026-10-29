import { createLocalizer, getCatalog } from "@riic/arknights-domain/i18n/localize";
import type { AppLocale } from "@riic/contracts/locale";
import type Account from "../messages/zh-CN/Account.json";
import type Records from "../messages/zh-CN/AccountRecords.json";
export const authText = createLocalizer<typeof Account.AuthValidation>("Account.AuthValidation");
export const authPanelText = createLocalizer<typeof Account.components_auth_WebsiteAccountPanel>("Account.components_auth_WebsiteAccountPanel");
export const authFeedbackText = createLocalizer<typeof Account.AuthFeedback>("Account.AuthFeedback");
export const authFlowText = createLocalizer<typeof Account.AuthFlow>("Account.AuthFlow");
type Indexable<T> = T extends unknown[] ? T : T & Record<string, T[keyof T]>;
export function messageRecord<K extends keyof typeof Records>(locale: AppLocale, key: K): Indexable<typeof Records[K]> {
  return getCatalog<typeof Records>(locale, "AccountRecords")[key] as Indexable<typeof Records[K]>;
}
