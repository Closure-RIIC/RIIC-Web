import type { DetailRecord, DetailValue } from "./details.ts";
export const record = (value: DetailValue | undefined): DetailRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
export const items = (value: DetailValue | undefined): DetailValue[] => Array.isArray(value) ? value : [];
export const text = (value: DetailValue | undefined) => typeof value === "string" || typeof value === "number" ? String(value) : "";
export const quantity = (value: DetailValue | undefined): number | null => {
  const n = typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
};
