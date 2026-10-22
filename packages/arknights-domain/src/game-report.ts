export type GameReportDay = { experience?: number; goldValue?: number; lmd?: number; orundum?: number; orderCount?: number };
export type GameReportSource = "screenshot" | "manual";
export type GameReportRecord = {
  id: string;
  sourceType: GameReportSource;
  days: [GameReportDay, GameReportDay, GameReportDay];
  createdAt: string;
};

export const GAME_REPORT_KEYS = ["experience", "goldValue", "lmd", "orderCount", "orundum"] as const;
const LEGACY_REPORT_KEYS = ["experience", "goldValue", "lmd", "orundum"] as const;

/**
 * Parse the three report columns. Existing stored reports use the strict
 * four-metric shape; new UI submissions may intentionally leave cells blank
 * and are normalized to omitted properties when allowPartial is true.
 */
export function parseGameReportDays(value: unknown, requireOrderCount = false, allowPartial = false): GameReportRecord["days"] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const days: GameReportDay[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).some((key) => !GAME_REPORT_KEYS.includes(key as typeof GAME_REPORT_KEYS[number]))) return null;
    const parsed: GameReportDay = {};
    for (const key of GAME_REPORT_KEYS) {
      const rawValue = item[key];
      if (rawValue === undefined || (allowPartial && rawValue === null)) continue;
      if (!Number.isSafeInteger(rawValue) || (rawValue as number) < 0 || (rawValue as number) > 99_999_999) return null;
      parsed[key] = rawValue as number;
    }
    if (!allowPartial && LEGACY_REPORT_KEYS.some((key) => parsed[key] === undefined)) return null;
    if (requireOrderCount && parsed.orderCount === undefined) return null;
    days.push(parsed);
  }
  if (allowPartial && !days.some((day) => GAME_REPORT_KEYS.some((key) => day[key] !== undefined))) return null;
  return days as GameReportRecord["days"];
}

export function gameReportAverage(days: GameReportRecord["days"]): GameReportDay {
  return Object.fromEntries(GAME_REPORT_KEYS.filter((key) => days.every((day) => day[key] !== undefined))
    .map((key) => [key, days.reduce((sum, day) => sum + day[key]!, 0) / 3])) as GameReportDay;
}
