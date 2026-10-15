export const LOCALE_COOKIE = "riic-locale";
export const LEGACY_LOCALE_STORAGE = "infra-demo-locale";
export type AppLocale = "zh" | "en";
export const DEFAULT_LOCALE: AppLocale = process.env.PUBLIC_DEFAULT_LOCALE === "en" ? "en" : "zh";
export function isAppLocale(value: unknown): value is AppLocale {
  return value === "zh" || value === "en";
}
export function resolveLocale(value: unknown): AppLocale {
  return isAppLocale(value) ? value : DEFAULT_LOCALE;
}
