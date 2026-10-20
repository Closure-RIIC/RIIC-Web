export interface EndfieldWeapon {
  instanceId: string;
  id: string;
  level: number | null;
  breakthroughLevel: number | null;
  refineLevel: number | null;
}
export interface EndfieldWeapons {
  status: "ready" | "partial" | "unavailable";
  items: EndfieldWeapon[];
}
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const number = (value: unknown, max: number) => {
  const n = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= max ? n : null;
};
/** Reuses calculator user-game-data; never merges inventories across roles or deduplicates weapon templates. */
export function normalizeEndfieldWeapons(response: unknown, selected: { roleId: string; serverId: string }): EndfieldWeapons {
  const envelope = record(response);
  const game = record(record(envelope.data ?? envelope).userGameData);
  const unavailable: EndfieldWeapons = { status: "unavailable", items: [] };
  if (("code" in envelope && envelope.code !== 0) ||
    ("roleId" in game && String(game.roleId) !== selected.roleId) ||
    ("serverId" in game && String(game.serverId) !== selected.serverId) || !game.userWeapons || typeof game.userWeapons !== "object") return unavailable;
  const entries = Object.entries(game.userWeapons);
  if (entries.length > 2000) return unavailable;
  const items: EndfieldWeapon[] = [];
  let partial = false;
  for (const [key, value] of entries) {
    const weapon = record(value);
    const id = [weapon.weaponId, record(weapon.weaponData).id, weapon.templateId, weapon.id, key]
      .find(id => typeof id === "string" && /^wpn_[a-zA-Z0-9_]{1,100}$/.test(id));
    if (typeof id !== "string") { partial = true; continue; }
    const level = number(weapon.level, 100);
    const breakthroughLevel = number(weapon.breakthroughLevel ?? weapon.breakthrough, 10);
    const refineLevel = number(weapon.refineLevel ?? weapon.refine, 10);
    if (level === null) partial = true;
    items.push({ instanceId: key, id, level, breakthroughLevel, refineLevel });
  }
  return { status: partial ? "partial" : "ready", items };
}
