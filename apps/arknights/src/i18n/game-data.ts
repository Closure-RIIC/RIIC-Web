import { localize as localize_Common } from "./helpers/Common.ts";
import type { GameCatalog } from "./game-catalog";
import type { AppLocale } from "@riic/arknights-domain/i18n/config";

// Game text is data: keep upstream records and manual overrides out of UI messages.
export function localizedOperatorName(name: string, locale: AppLocale, catalog: GameCatalog | null) {
  return locale !== "zh-CN" ? catalog?.operatorNames[name] ?? name : name;
}

export function localizedRoomTitle(title: string, group: string, locale: AppLocale, catalog: GameCatalog | null) {
  if (locale === "zh-CN") return title;
  const label = catalog?.roomLabels[group];
  if (!label) return title;
  const index = title.match(/\d+\s*$/)?.[0]?.trim();
  return index ? `${label} ${index}` : label;
}

export function localizedBuildingSkill<T extends { name: string; description: string; descriptionRich?: string }>(id: string, locale: AppLocale, fallback: T, catalog: GameCatalog | null): T {
  if (locale === "zh-CN") return fallback;
  if (!catalog) return fallback;
  const translated = catalog.buildingSkills[id];
  return translated
    ? { ...fallback, name: translated.name, description: translated.description, descriptionRich: translated.description }
    : { ...fallback, name: localize_Common.text(locale, "missingSkillName"), description: localize_Common.text(locale, "missingSkillText"), descriptionRich: localize_Common.text(locale, "missingSkillText") };
}
