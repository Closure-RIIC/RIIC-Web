import { createTranslator } from "use-intl/core";
import type { ReactNode } from "react";
import type { AppLocale } from "./config.ts";

type Values = Record<string, string | number | Date>;
type RichValues = Record<string, string | number | Date | ((chunks: ReactNode) => ReactNode)>;

/** Small explicit-locale translator for non-React presentation functions. */
export function createLocalizer<M extends Record<string, string>>(zh: M, en: M) {
  const translators = {
    zh: createTranslator<Record<string, string>>({ locale: "zh", messages: zh }),
    en: createTranslator<Record<string, string>>({ locale: "en", messages: en }),
  };
  const select = (locale: AppLocale | boolean) => translators[locale === true || locale === "en" ? "en" : "zh"];
  return {
    text: (locale: AppLocale | boolean, key: keyof M & string, values?: Values) => select(locale)(key as string, values),
    rich: (locale: AppLocale | boolean, key: keyof M & string, values: RichValues) => select(locale).rich(key as string, values),
  };
}
