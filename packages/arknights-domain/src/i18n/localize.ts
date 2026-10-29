import { createTranslator } from "use-intl/core";
import type { AbstractIntlMessages } from "use-intl";
import type { ReactNode } from "react";
import type { AppLocale } from "./config.ts";

type Values = Record<string, string | number | Date>;
type RichValues = Record<string, string | number | Date | ((chunks: ReactNode) => ReactNode)>;
/** Capture an already narrowed render value before use-intl invokes its tag callback. */
export const richValue = (content: ReactNode) => () => content;

// Only explicitly keyed, immutable resources are shared between requests.
// Never store a current/global locale: callers supply their own snapshot.
const catalogs = new Map<string, AbstractIntlMessages>();
const translators = new Map<string, ReturnType<typeof createTranslator<Record<string, string>>>>();

export function registerMessages(locale: AppLocale, messages: AbstractIntlMessages) {
  for (const [namespace, catalog] of Object.entries(messages)) {
    if (typeof catalog !== "object") continue;
    const id = `${locale}:${namespace}`;
    if (!catalogs.has(id)) catalogs.set(id, catalog);
  }
}

export function getCatalog<T = AbstractIntlMessages>(locale: AppLocale, namespace: string): T {
  const [root, ...parts] = namespace.split(".");
  let catalog = catalogs.get(`${locale}:${root}`);
  for (const part of parts) catalog = catalog?.[part] as AbstractIntlMessages | undefined;
  if (!catalog) throw new Error(`Messages not loaded: ${locale}:${namespace}`);
  return catalog as T;
}

/** Non-React presentation functions consume resources loaded by their feature. */
export function createLocalizer<M extends Record<string, string>>(namespace: string) {
  const select = (locale: AppLocale) => {
    const id = `${locale}:${namespace}`;
    let translator = translators.get(id);
    if (!translator) {
      translator = createTranslator<Record<string, string>>({ locale, messages: getCatalog(locale, namespace) });
      translators.set(id, translator);
    }
    return translator;
  };
  return {
    text: (locale: AppLocale, key: keyof M & string, values?: Values) => select(locale)(key as string, values),
    rich: (locale: AppLocale, key: keyof M & string, values: RichValues) => select(locale).rich(key as string, values),
  };
}
