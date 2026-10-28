import type { DetailRecord, DetailValue } from "./details.ts";
export const record = (value: DetailValue | undefined): DetailRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
export const items = (value: DetailValue | undefined): DetailValue[] => Array.isArray(value) ? value : [];
export const text = (value: DetailValue | undefined) => typeof value === "string" || typeof value === "number" ? String(value) : "";
export const quantity = (value: DetailValue | undefined): number | null => {
  const n = typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
};
export type FavorabilityLevel = "friendly" | "close" | "trusted";
export const physicalStrengthPercent = (value: DetailValue | undefined): string | null => {
  const n = quantity(value);
  return n === null ? null : `${(Math.min(n, 10_000) / 100).toFixed(2).replace(/\.00$/, "")}%`;
};
export const sortShipCrewByMood = (crew: DetailValue[]): DetailValue[] => crew
  .map((value, index) => ({ value, index, mood: quantity(record(value).physicalStrength) }))
  .sort((a, b) => (a.mood ?? Number.POSITIVE_INFINITY) - (b.mood ?? Number.POSITIVE_INFINITY) || a.index - b.index)
  .map(({ value }) => value);
export const shipRoomsForDisplay = (rooms: DetailValue[]): DetailValue[] => {
  const hasClueRoom = rooms.some(value => text(record(value).type) === "5");
  return hasClueRoom ? rooms.filter(value => text(record(value).type) !== "3") : rooms;
};
export const shipFavorability = (value: DetailValue | undefined): { percent: string; level: FavorabilityLevel } | null => {
  const n = quantity(value);
  if (n === null) return null;
  const capped = Math.min(n, 1_500);
  const percent = capped <= 300 ? capped / 300 * 100 : 100 + (capped - 300) / 1_200 * 100;
  return {
    percent: `${Math.floor(percent)}%`,
    level: capped >= 1_500 ? "trusted" : capped >= 300 ? "close" : "friendly",
  };
};
