import type { AppLocale } from "@riic/contracts/locale";
import { getCatalog } from "@riic/arknights-domain/i18n/localize";
import type Records from "../../messages/zh-CN/records.json";
type Indexable<T> = T extends unknown[] ? T : T & Record<string, T[keyof T]>;
export function messageRecord<K extends keyof typeof Records>(locale: AppLocale, key: K): Indexable<typeof Records[K]> {
  return getCatalog<typeof Records>(locale, "records")[key] as Indexable<typeof Records[K]>;
}
