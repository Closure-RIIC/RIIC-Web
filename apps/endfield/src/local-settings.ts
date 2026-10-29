import { STORAGE_KEY } from "@riic/endfield-solver/model.mjs";
import { RESULT_STORAGE_KEY } from "./result-cache.ts";
import { STEP_STORAGE_KEY } from "./step/step-keys.ts";
import { readLocaleCookie, type AppLocale } from "@riic/contracts/locale";

export const ENDFIELD_LOCALE_COOKIE = "riic-endfield-locale";
export const DISPLAY_STORAGE_KEY = "riic:endfield:display";
export function readEndfieldColorMode(saved: string | null): "light" | "dark" {
  return saved === "dark" ? "dark" : "light";
}
export function readEndfieldLocale(cookie: string): AppLocale {
  return readLocaleCookie(cookie, [ENDFIELD_LOCALE_COOKIE, "riic-locale"]);
}
export function clearEndfieldStorage(local: Pick<Storage, "removeItem">, session: Pick<Storage, "removeItem">) {
  for (const key of [STORAGE_KEY, RESULT_STORAGE_KEY, STEP_STORAGE_KEY, DISPLAY_STORAGE_KEY, "riic-color-mode"]) local.removeItem(key);
  session.removeItem("riic:endfield:skland-selection");
}
