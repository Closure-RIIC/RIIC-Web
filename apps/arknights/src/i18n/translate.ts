import { createTranslator } from "use-intl/core";
import type { AppLocale } from "./config.ts";
import zhRecords from "../../messages/records/zh.json" with { type: "json" };
import enRecords from "../../messages/records/en.json" with { type: "json" };

const recordTranslators = {
  // raw() supports structured messages, including arrays. Keep its public key
  // type bounded; messageRecord exposes the actual JSON shape to callers.
  zh: createTranslator<Record<string, string>>({ locale: "zh", messages: zhRecords as unknown as Record<string, string> }),
  en: createTranslator<Record<string, string>>({ locale: "en", messages: enRecords as unknown as Record<string, string> }),
};
type Indexable<T> = T extends unknown[] ? T : T & Record<string, T[keyof T]>;
export function messageRecord<K extends keyof typeof zhRecords>(locale: AppLocale | boolean, key: K): Indexable<typeof zhRecords[K]> {
  return recordTranslators[locale === true || locale === "en" ? "en" : "zh"].raw(key);
}
