import { selectedEndfieldDetails, type DetailRecord } from "./details.ts";
import type { EndfieldInventory } from "./inventory.ts";
import type { EndfieldWeapons } from "./weapons.ts";

export interface EndfieldRole {
  uid: string;
  roleId: string;
  serverId: string;
  nickname: string;
  serverName: string;
  isDefault: boolean;
}

export interface EndfieldSnapshot {
  game: "endfield";
  role: { roleId: string; name: string; serverName: string; level: number };
  /** `latestSpaceshipSkillNodes`：玩家实际解锁的基建技能节点（每槽最高档）。 */
  characters: { id: string; name: string; elite: number; level: number; latestSpaceshipSkillNodes: string[] }[];
  rooms: { id: string; type: number; level: number }[];
  facilitiesComplete?: boolean;
  rosterComplete?: boolean;
  details?: DetailRecord;
  inventory?: EndfieldInventory;
  weapons?: EndfieldWeapons;
  fetchedAt: number;
}

export class EndfieldDataError extends Error {}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown, max = 128): string {
  return typeof value === "string" && value.length <= max ? value.trim() : "";
}
function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}
function roomInteger(value: unknown, min: number, max: number): number | null {
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return integer(number, min, max) ? number : null;
}

/** A binding contains several games. Never fall back to an Arknights UID. */
export function endfieldRolesFromBinding(input: unknown): EndfieldRole[] {
  const list = object(input).list;
  if (!Array.isArray(list)) throw new EndfieldDataError("森空岛角色列表格式无效。");
  const result: EndfieldRole[] = [];
  const seen = new Set<string>();
  for (const gameValue of list) {
    const game = object(gameValue);
    if (game.appCode !== "endfield" || !Array.isArray(game.bindingList)) continue;
    for (const item of game.bindingList) {
      const binding = object(item);
      const uid = text(binding.uid);
      if (!uid || binding.isDelete || !Array.isArray(binding.roles)) continue;
      for (const roleValue of binding.roles) {
        const role = object(roleValue);
        const roleId = text(role.roleId);
        const serverId = text(role.serverId);
        const key = `${serverId}:${roleId}`;
        if (!roleId || !serverId || role.isBanned || seen.has(key)) continue;
        seen.add(key);
        result.push({
          uid, roleId, serverId,
          nickname: text(role.nickname) || text(binding.nickName) || roleId,
          serverName: text(role.serverName) || serverId,
          isDefault: role.isDefault === true,
        });
      }
    }
  }
  return result;
}

/** Keep display data separate from the validated scheduling inputs. */
export function normalizeEndfieldSnapshot(input: unknown, now = Date.now()): EndfieldSnapshot {
  const envelope = object(input);
  if ("code" in envelope && envelope.code !== 0) throw new EndfieldDataError("森空岛返回了错误结果，请重新同步。");
  const data = object(envelope.data ?? envelope);
  const detail = object(data.detail ?? data);
  const base = object(detail.base);
  const config = object(detail.config);
  if (!text(base.roleId) || !text(base.name) || !Array.isArray(detail.chars)) {
    throw new EndfieldDataError("请导入终末地角色详情 JSON，不能使用明日方舟数据。");
  }
  const rosterComplete = config.charSwitch !== false && !(integer(base.charNum, 1, 1000) && detail.chars.length < base.charNum);
  if (detail.chars.length > 1000) throw new EndfieldDataError("干员列表过大。");
  const seen = new Set<string>();
  const characters = detail.chars.map(value => {
    const character = object(value);
    const charData = object(character.charData);
    // The outer id can identify an owned instance; charData.id identifies its template.
    const id = text(charData.id) || text(character.id);
    const name = text(charData.name);
    if (!id || !name || seen.has(id) || !integer(character.evolvePhase, 0, 4) || !integer(character.level, 1, 100)) {
      throw new EndfieldDataError("干员 ID、等级或精英化数据不完整，请重新同步。");
    }
    seen.add(id);
    // `talent.latestSpaceshipSkillNodes` 是该玩家实际解锁的最高档节点，和精英化互相独立。
    // 缺失或非法（含非数组）一律视为"没有解锁任何基建技能"，不做精英化推断。
    const talent = object(character.talent);
    const rawNodes = Array.isArray(talent.latestSpaceshipSkillNodes) ? talent.latestSpaceshipSkillNodes : [];
    const latestSpaceshipSkillNodes = [...new Set(rawNodes
      .filter((node): node is string => typeof node === "string" && node.startsWith("spaceship_skill_") && node.length <= 128))];
    return { id, name, elite: character.evolvePhase, level: character.level, latestSpaceshipSkillNodes };
  });
  const rooms: EndfieldSnapshot["rooms"] = [];
  const roomIds = new Map<string, EndfieldSnapshot["rooms"][number]>();
  // Current card responses put the ship beside domain, not inside it. Keep the
  // nested shape for older exports, but never mix it into an authoritative root list.
  const rootShip = object(detail.spaceShip);
  const roomLists = "rooms" in rootShip ? [rootShip.rooms]
    : (Array.isArray(detail.domain) ? detail.domain : [])
      .map(domain => object(object(domain).spaceShip).rooms).filter(value => value !== undefined);
  let facilitiesComplete = roomLists.length > 0;
  for (const rawRooms of roomLists) {
    if (!Array.isArray(rawRooms)) { facilitiesComplete = false; continue; }
    const typeOrdinals = new Map<number, number>();
    for (const value of rawRooms) {
      const room = object(value);
      const type = roomInteger(room.type, 0, 1000), level = roomInteger(room.level, 0, 20);
      if (type === null || level === null) { facilitiesComplete = false; continue; }
      const ordinal = (typeOrdinals.get(type) ?? 0) + 1;
      typeOrdinals.set(type, ordinal);
      // Skland may redact every room ID to "" while retaining its type and level.
      // Keep distinct manufacturing rooms using their order within the room type.
      const id = text(room.id) || (integer(room.id, 0, Number.MAX_SAFE_INTEGER) ? String(room.id) : `skland-room-${type}-${ordinal}`);
      const previous = roomIds.get(id);
      if (previous) {
        if (previous.type !== type || previous.level !== level) facilitiesComplete = false;
        continue;
      }
      const normalized = { id, type, level };
      roomIds.set(id, normalized);
      rooms.push(normalized);
    }
  }
  return {
    game: "endfield",
    role: { roleId: text(base.roleId), name: text(base.name), serverName: text(base.serverName), level: integer(base.level, 0, 1000) ? base.level : 0 },
    characters, rooms, facilitiesComplete, rosterComplete, details: selectedEndfieldDetails(detail), fetchedAt: now,
  };
}

type CatalogOperator = { id: string; name: string };

/** Template IDs take priority. Endfield-only exact names bridge API identifier variants. */
export function matchEndfieldRoster(snapshot: EndfieldSnapshot, catalog: readonly CatalogOperator[], nonSchedulable: readonly CatalogOperator[] = []) {
  if (snapshot.game !== "endfield") throw new EndfieldDataError("只能导入终末地干员数据。");
  const entries = [...catalog.map(operator => ({ ...operator, schedulable: true })),
    ...nonSchedulable.map(operator => ({ ...operator, schedulable: false }))];
  const byId = new Map(entries.map(operator => [operator.id, operator]));
  const byName = new Map<string, (typeof entries)[number] | null>();
  for (const operator of entries) {
    const previous = byName.get(operator.name);
    // Multiple playable templates sharing a name are ambiguous. Non-schedulable
    // Endministrator variants share the same exclusion reason and can be grouped.
    byName.set(operator.name, previous === undefined ? operator
      : previous && !previous.schedulable && !operator.schedulable ? previous : null);
  }
  const operators: { name: string; elite: number; latestSpaceshipSkillNodes: string[] }[] = [];
  const unsupported: string[] = [];
  const excluded = new Set<string>();
  const seen = new Set<string>();
  for (const character of snapshot.characters) {
    const known = byId.get(character.id) ?? byName.get(character.name);
    if (!known) { unsupported.push(character.name); continue; }
    if (!known.schedulable) { excluded.add(known.name); continue; }
    if (seen.has(known.name)) throw new EndfieldDataError("名单包含重复干员。");
    seen.add(known.name);
    operators.push({ name: known.name, elite: character.elite, latestSpaceshipSkillNodes: character.latestSpaceshipSkillNodes });
  }
  return { operators, unsupported, excluded: [...excluded] };
}

/** Room type IDs follow our pinned SpaceshipRoomTypeTable. Incomplete data is not inferred. */
export function endfieldFacilityLevels(snapshot: EndfieldSnapshot) {
  if (snapshot.facilitiesComplete === false) return null;
  const ofType = (type: number) => snapshot.rooms.filter(room => room.type === type).sort((a, b) => a.id.localeCompare(b.id));
  const centers = ofType(0), manufacturing = ofType(1), growth = ofType(2), guests = ofType(5).length ? ofType(5) : ofType(3);
  if (centers.length !== 1 || manufacturing.length !== 2 || growth.length > 1 || guests.length > 1) return null;
  const center = centers[0].level;
  if (center < 1 || center > 5) return null;
  const maxMfg = center >= 4 ? 3 : center >= 2 ? 2 : 1;
  const maxGrow = center >= 5 ? 3 : center >= 3 ? 2 : center >= 2 ? 1 : 0;
  const maxGuest = center >= 5 ? 3 : center >= 4 ? 2 : center >= 3 ? 1 : 0;
  const levels = { center, mfg1: manufacturing[0].level, mfg2: manufacturing[1].level, grow: growth[0]?.level ?? 0, guest: guests[0]?.level ?? 0 };
  if (levels.mfg1 < 1 || levels.mfg2 < 1 || levels.mfg1 > maxMfg || levels.mfg2 > maxMfg || levels.grow > maxGrow || levels.guest > maxGuest) return null;
  return levels;
}
