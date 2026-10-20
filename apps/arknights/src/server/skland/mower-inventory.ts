import { readFile } from "node:fs/promises";
import path from "node:path";

import type { SklandInventoryItem } from "@/types";

type MowerItemRecord = Record<string, unknown>;

function numeric(value: unknown): number | null {
  const result = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() && Number.isFinite(Number(value))
      ? Number(value)
      : null;
  return result !== null && Number.isFinite(result) && result >= 0 ? Math.floor(result) : null;
}

function addItem(target: Map<string, number>, idValue: unknown, countValue: unknown): void {
  const id = String(idValue ?? "").trim();
  const count = numeric(countValue);
  if (!/^\d+$/.test(id) || count === null) return;
  target.set(id, Math.max(target.get(id) ?? 0, count));
}

function fromIdMap(value: unknown): Map<string, number> {
  const result = new Map<string, number>();
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [id, count] of Object.entries(value)) addItem(result, id, count);
  return result;
}

function fromClassifiedData(value: unknown): Map<string, number> {
  const result = new Map<string, number>();
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  const visit = (entry: unknown) => {
    if (!entry || typeof entry !== "object") return;
    if (Array.isArray(entry)) {
      for (const child of entry) visit(child);
      return;
    }
    const record = entry as MowerItemRecord;
    if ("number" in record) {
      const itemName = String(record.icon ?? record.name ?? "").trim();
      if (/^\d+$/.test(itemName)) addItem(result, itemName, record.number);
    }
    for (const child of Object.values(record)) {
      if (child && typeof child === "object") visit(child);
    }
  };
  visit(value);
  return result;
}

export function parseMowerDepotResponse(value: unknown): SklandInventoryItem[] {
  const result = new Map<string, number>();
  if (Array.isArray(value)) {
    const idMap = typeof value[1] === "string"
      ? (() => {
          try {
            return JSON.parse(value[1]) as unknown;
          } catch {
            return null;
          }
        })()
      : value[1];
    for (const [id, count] of fromIdMap(idMap)) result.set(id, count);
    for (const [id, count] of fromClassifiedData(value[0])) {
      if (!result.has(id)) result.set(id, count);
    }
  } else {
    for (const [id, count] of fromIdMap(value)) result.set(id, count);
  }
  return [...result.entries()].map(([id, count]) => ({ id, count }));
}

export function mergeInventoryItems(
  primary: SklandInventoryItem[],
  fallback: SklandInventoryItem[],
): SklandInventoryItem[] {
  const merged = new Map<string, number>();
  for (const item of fallback) merged.set(item.id, item.count);
  for (const item of primary) {
    // Match mower: an absent/zero API resource must not erase a positive scan.
    if (item.count > 0 || !merged.has(item.id)) merged.set(item.id, item.count);
  }
  return [...merged.entries()].map(([id, count]) => ({ id, count }));
}

function mowerBaseUrl(): string | null {
  const raw = process.env.MOWER_BASE_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

async function readMowerFiles(): Promise<SklandInventoryItem[]> {
  const root = process.env.MOWER_SOURCE_DIR?.trim();
  if (!root) return [];
  const result: SklandInventoryItem[] = [];
  try {
    const raw = JSON.parse(await readFile(path.join(root, "tmp", "cultivate.json"), "utf8")) as unknown;
    result.push(...parseMowerDepotResponse(raw));
  } catch {
    // The file is optional; the HTTP adapter below remains the normal path.
  }
  return result;
}

export async function loadMowerInventory(): Promise<SklandInventoryItem[]> {
  const fileItems = await readMowerFiles();
  const baseUrl = mowerBaseUrl();
  if (!baseUrl) return fileItems;
  try {
    const response = await fetch(`${baseUrl}/depot/readdepot`, {
      signal: AbortSignal.timeout(2_000),
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return fileItems;
    return mergeInventoryItems(parseMowerDepotResponse(await response.json() as unknown), fileItems);
  } catch {
    return fileItems;
  }
}
