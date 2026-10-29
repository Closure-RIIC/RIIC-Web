import type { AppLocale } from "@riic/contracts/locale";
import { getCatalog } from "@riic/arknights-domain/i18n/localize";
import { operatorData } from "@riic/endfield-data";

type Field = "name" | "description" | "profession" | "room" | "effectName" | "target" | "clueTierName";
type GameText = Record<string, Partial<Record<Field, string>>>;
/** Display text never replaces the canonical names/IDs used by the solver and saves. */
export function displayText(record: { id: string; name?: string } | undefined, field: Field, locale: AppLocale): string {
  if (!record) return "";
  return getCatalog<GameText>(locale, "EndfieldGameData")[record.id]?.[field] ?? (field === "name" ? record.name ?? record.id : "");
}
export function operatorName(name: string, locale: AppLocale): string {
  return displayText(operatorData(name), "name", locale) || name;
}
