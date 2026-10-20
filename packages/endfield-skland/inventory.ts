import { publicEndfieldDetails } from "./details.ts";

export type EndfieldMaterialGroup = "materials" | "charExpMaterials" | "weaponExpMaterials" | "other";
export interface EndfieldInventoryItem {
  id: string;
  name: string;
  icon?: string;
  group: EndfieldMaterialGroup;
  count: number | null;
}
export interface EndfieldInventory {
  status: "ready" | "partial" | "unavailable";
  issue?: "catalog" | "counts" | "identity" | "incomplete";
  items: EndfieldInventoryItem[];
}

const MAX_ITEMS = 2000;
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown, max = 256) => typeof value === "string" && value.length <= max ? value.trim() : "";
const validId = (id: string) => /^[A-Za-z0-9_-]{1,128}$/.test(id) && !["__proto__", "constructor", "prototype"].includes(id);
function dataOf(value: unknown) {
  const envelope = record(value);
  if (!envelope || ("code" in envelope && envelope.code !== 0)) return null;
  return record(envelope.data ?? envelope);
}
function countOf(value: unknown): number | null {
  const count = typeof value === "string" && /^\d{1,16}$/.test(value) ? Number(value) : value;
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : null;
}
function iconOf(value: unknown): string | undefined {
  const icon = text(value, 2048);
  if (!/^https:\/\//i.test(icon)) return undefined;
  return publicEndfieldDetails({ icon }).icon === icon ? icon : undefined;
}

/**
 * material-list supplies the catalog; user-game-data supplies itemCount.
 * Requests select the role via sk-game-role. Check returned identity when present.
 * Missing quantities stay unknown, never silently become zero.
 */
export function normalizeEndfieldInventory(
  catalogResponse: unknown,
  inventoryResponse: unknown,
  selected: { roleId: string; serverId: string },
): EndfieldInventory {
  const catalog = dataOf(catalogResponse);
  const game = record(dataOf(inventoryResponse)?.userGameData);
  if (game && (("roleId" in game && String(game.roleId) !== selected.roleId)
    || ("serverId" in game && String(game.serverId) !== selected.serverId))) {
    return { status: "unavailable", issue: "identity", items: [] };
  }
  const counts = record(game?.itemCount);
  if (counts && Object.keys(counts).length > MAX_ITEMS) return { status: "unavailable", issue: "counts", items: [] };
  const materials = new Map<string, EndfieldInventoryItem>();
  let incomplete = false;
  for (const group of ["materials", "charExpMaterials", "weaponExpMaterials"] as const) {
    const entries = Object.entries(record(catalog?.[group]) ?? {});
    if (entries.length > MAX_ITEMS) return { status: "unavailable", issue: "catalog", items: [] };
    for (const [key, value] of entries) {
      const item = record(value);
      if (!validId(key) || !item || (item.id !== undefined && String(item.id) !== key)) { incomplete = true; continue; }
      const previous = materials.get(key);
      const name = text(item.name) || previous?.name || key;
      if (name === key) incomplete = true;
      materials.set(key, { id: key, name, icon: iconOf(item.icon) ?? previous?.icon, group, count: null });
    }
  }
  const hasCatalog = materials.size > 0;
  for (const [id, value] of Object.entries(counts ?? {})) {
    if (!validId(id)) { incomplete = true; continue; }
    const count = countOf(value);
    const previous = materials.get(id);
    if (!previous) incomplete = true;
    materials.set(id, previous ? { ...previous, count } : { id, name: id, count, group: "other" });
  }
  if (materials.size > MAX_ITEMS) return { status: "unavailable", issue: "catalog", items: [] };
  const priorities = new Map<string, number>();
  if (Array.isArray(catalog?.priorities)) {
    for (const value of catalog.priorities.slice(0, MAX_ITEMS)) {
      const ids = record(value)?.ids;
      if (Array.isArray(ids)) for (const id of ids.slice(0, MAX_ITEMS)) {
        if (typeof id === "string" && !priorities.has(id)) priorities.set(id, priorities.size);
      }
    }
  }
  const items = [...materials.values()].sort((a, b) =>
    (priorities.get(a.id) ?? MAX_ITEMS) - (priorities.get(b.id) ?? MAX_ITEMS));
  if (items.some(item => item.count === null)) incomplete = true;
  const issue = !hasCatalog ? "catalog" : !counts ? "counts" : incomplete ? "incomplete" : undefined;
  return { status: !items.length ? "unavailable" : issue ? "partial" : "ready", ...(issue ? { issue } : {}), items };
}
