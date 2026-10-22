import { createLocalizer } from "@riic/arknights-domain/i18n/localize";
import zh from "./zh.json" with { type: "json" };
import en from "./en.json" with { type: "json" };
import zhRecords from "./zh-records.json" with { type: "json" };
import enRecords from "./en-records.json" with { type: "json" };

export const authMessages = { zh, en };
export const authText = createLocalizer(zh.AuthValidation, en.AuthValidation);
export const authPanelText = createLocalizer(zh.components_auth_WebsiteAccountPanel, en.components_auth_WebsiteAccountPanel);
export const authFeedbackText = createLocalizer(zh.AuthFeedback, en.AuthFeedback);
export const authFlowText = createLocalizer(zh.AuthFlow, en.AuthFlow);

type Indexable<T> = T extends unknown[] ? T : T & Record<string, T[keyof T]>;
export function messageRecord<K extends keyof typeof zhRecords>(locale: string | boolean, key: K): Indexable<typeof zhRecords[K]> {
  return (locale === true || locale === "en" ? enRecords : zhRecords)[key] as Indexable<typeof zhRecords[K]>;
}
