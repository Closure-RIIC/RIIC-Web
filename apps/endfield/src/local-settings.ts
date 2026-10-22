import { STORAGE_KEY } from "@riic/endfield-solver/model.mjs";
import { RESULT_STORAGE_KEY } from "./result-cache.ts";

export const ENDFIELD_LOCALE_COOKIE = "riic-endfield-locale";
export const DISPLAY_STORAGE_KEY = "riic:endfield:display";
export function readEndfieldColorMode(saved: string | null): "light" | "dark" {
  return saved === "dark" ? "dark" : "light";
}
export function readEndfieldLocale(cookie: string): "zh" | "en" {
  const cookies = cookie.split(";").map(item => item.trim());
  const saved = cookies.find(item => item.startsWith(`${ENDFIELD_LOCALE_COOKIE}=`))
    ?? cookies.find(item => item.startsWith("riic-locale="));
  return saved?.endsWith("=en") ? "en" : "zh";
}
export function clearEndfieldStorage(local: Pick<Storage, "removeItem">, session: Pick<Storage, "removeItem">) {
  for (const key of [STORAGE_KEY, RESULT_STORAGE_KEY, DISPLAY_STORAGE_KEY, "riic-color-mode"]) local.removeItem(key);
  session.removeItem("riic:endfield:skland-selection");
}
