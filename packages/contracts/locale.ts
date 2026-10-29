/** UI language is independent of game/server region and stored game identifiers. */
export const APP_LOCALES = ["zh-CN", "zh-TW", "en"] as const;
export type AppLocale = typeof APP_LOCALES[number];
export const DEFAULT_LOCALE: AppLocale = "zh-CN";
export const LOCALE_LABELS: Record<AppLocale, string> = {
  "zh-CN": "简体中文", "zh-TW": "繁體中文（台灣）", en: "English",
};

const aliases: Readonly<Record<string, AppLocale>> = {
  zh: "zh-CN", "zh-cn": "zh-CN", "zh-hans": "zh-CN", "zh-sg": "zh-CN",
  "zh-tw": "zh-TW", "zh-hant": "zh-TW", "zh-hk": "zh-TW",
  en: "en", "en-us": "en", "en-gb": "en",
};
export function parseLocale(value: unknown): AppLocale | undefined {
  if (typeof value !== "string") return undefined;
  const key = value.toLowerCase();
  return Object.hasOwn(aliases, key) ? aliases[key] : undefined;
}
export function resolveLocale(value: unknown): AppLocale { return parseLocale(value) ?? DEFAULT_LOCALE; }
export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (APP_LOCALES as readonly string[]).includes(value);
}
export function readLocaleCookie(cookie: string, names: readonly string[]): AppLocale {
  const values = new Map(cookie.split(";").map(part => {
    const index = part.indexOf("=");
    return [part.slice(0, index).trim(), part.slice(index + 1)] as const;
  }));
  for (const name of names) {
    const locale = parseLocale(values.get(name));
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}
export function localizedGameHref(href: string, locale: AppLocale): string {
  const url = new URL(href);
  url.searchParams.set("ui_locale", locale);
  return url.href;
}
