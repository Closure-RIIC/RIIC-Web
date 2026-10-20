import { localize as localize_Common } from "./helpers/Common.ts";
import type { EnglishCatalog } from "./game-catalog";
import type { AppLocale } from "./config";

// Game text is data: keep upstream records and manual overrides out of UI messages.
let request: Promise<EnglishCatalog> | null = null;

export function loadGameCatalog() {
  request ??= import("./game-catalog").then(({ ENGLISH_CATALOG }) => ENGLISH_CATALOG).catch((error) => { request = null; throw error; });
  return request;
}
export function localizedOperatorName(name: string, locale: AppLocale, catalog: EnglishCatalog | null) {
  return locale === "en" ? catalog?.operatorNames[name] ?? name : name;
}

export function localizedRoomTitle(title: string, group: string, locale: AppLocale, catalog: EnglishCatalog | null) {
  if (locale !== "en") return title;
  const label = catalog?.roomLabels[group];
  if (!label) return title;
  const index = title.match(/\d+\s*$/)?.[0]?.trim();
  return index ? `${label} ${index}` : label;
}

export function localizedBuildingSkill<T extends { name: string; description: string; descriptionRich?: string }>(id: string, locale: AppLocale, fallback: T, catalog: EnglishCatalog | null): T {
  if (locale !== "en") return fallback;
  if (!catalog) return fallback;
  const translated = catalog.buildingSkills[id];
  return translated
    ? { ...fallback, name: translated.name, description: translated.description, descriptionRich: translated.description }
    : { ...fallback, name: localize_Common.text(locale, "missingSkillName"), description: localize_Common.text(locale, "missingSkillText"), descriptionRich: localize_Common.text(locale, "missingSkillText") };
}
