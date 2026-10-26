import { isDefensePortrait, type DefensePortrait } from "./defense-portraits";
export { DEFENSE_PORTRAITS, defensePortraitUrl, type DefensePortrait } from "./defense-portraits";
export const TEAM_CAPACITY = 4;
export type GameServer = "official" | "bilibili";
export const TEAM_DIFFICULTIES = ["ac1", "ac2", "ac3", "ac4"] as const;
export const DEFENSE_CORE_BONDS = [
  "yan",
  "sargon",
  "victoria",
  "kjerag",
  "laterano",
  "aegir",
  "siracusa",
  "kazimierz",
] as const;
export const DEFENSE_ADDON_BONDS = [
  "harmony",
  "precision",
  "swift",
  "dexterity",
  "arcane",
  "steadfast",
  "support",
  "foresight",
  "miracle",
  "investor",
  "assault",
  "unyielding",
  "assistant",
  "solo",
  "technique",
] as const;
// Keep existing account values and their canonical ordering compatible.
export const DEFENSE_FACTIONS = [
  "aegir",
  "kazimierz",
  "laterano",
  "sargon",
  "victoria",
  "kjerag",
  "siracusa",
  "yan",
  ...DEFENSE_ADDON_BONDS,
] as const;
export type DefenseFaction = (typeof DEFENSE_FACTIONS)[number];
export const CORE_BOND_MIN = 2;
export const CORE_BOND_MAX = 4;
export function coreBondCount(bonds: readonly DefenseFaction[]) {
  return new Set(
    bonds.filter((b) => (DEFENSE_CORE_BONDS as readonly string[]).includes(b)),
  ).size;
}
export function validCoreBondSelection(bonds: readonly DefenseFaction[]) {
  const count = coreBondCount(bonds);
  return count >= CORE_BOND_MIN && count <= CORE_BOND_MAX;
}
export type DefenseProfile = {
  portrait: DefensePortrait;
  id: string;
  name: string;
  favoriteFactions: DefenseFaction[];
};
export function parseFavoriteFactions(value: unknown): DefenseFaction[] | null {
  if (
    !Array.isArray(value) ||
    value.length > DEFENSE_FACTIONS.length ||
    value.some(
      (item) => !(DEFENSE_FACTIONS as readonly unknown[]).includes(item),
    )
  )
    return null;
  if (new Set(value).size !== value.length) return null;
  return DEFENSE_FACTIONS.filter((faction) => value.includes(faction));
}
export type TeamPreferences = {
  difficulty: "any" | (typeof TEAM_DIFFICULTIES)[number];
};
export type BondMatchPreferences = {
  useProfileBonds: boolean;
  preferredBonds: DefenseFaction[];
  requiredCoreBonds: DefenseFaction[];
  requiredAddonBonds: DefenseFaction[];
  avoidBondOverlap: boolean;
};
export function parseBondMatchPreferences(
  value: unknown,
): BondMatchPreferences | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  for (const key of ["useProfileBonds", "avoidBondOverlap"])
    if (input[key] !== undefined && typeof input[key] !== "boolean")
      return null;
  const preferredBonds = parseFavoriteFactions(input.preferredBonds ?? []);
  const requiredCoreBonds = parseFavoriteFactions(
    input.requiredCoreBonds ?? [],
  );
  const requiredAddonBonds = parseFavoriteFactions(
    input.requiredAddonBonds ?? [],
  );
  if (
    !preferredBonds ||
    !requiredCoreBonds ||
    !requiredAddonBonds ||
    requiredCoreBonds.some(
      (b) => !(DEFENSE_CORE_BONDS as readonly string[]).includes(b),
    ) ||
    requiredAddonBonds.some(
      (b) => !(DEFENSE_ADDON_BONDS as readonly string[]).includes(b),
    )
  )
    return null;
  return {
    useProfileBonds: input.useProfileBonds !== false,
    preferredBonds,
    requiredCoreBonds,
    requiredAddonBonds,
    avoidBondOverlap: input.avoidBondOverlap !== false,
  };
}
export const DEFAULT_BOND_MATCH_PREFERENCES: BondMatchPreferences = {
  useProfileBonds: true,
  preferredBonds: [],
  requiredCoreBonds: [],
  requiredAddonBonds: [],
  avoidBondOverlap: true,
};
export function parseTeamPreferences(value: unknown): TeamPreferences | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const difficulty = input.difficulty ?? "any";
  if (!["any", ...TEAM_DIFFICULTIES].includes(difficulty as string))
    return null;
  return { difficulty } as TeamPreferences;
}
export function matchesTeamPreferences(
  room: TeamPreferences,
  preferences: TeamPreferences,
) {
  return (
    preferences.difficulty === "any" ||
    room.difficulty === preferences.difficulty
  );
}
export function parseDefenseInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (
    ![
      "create",
      "join",
      "join-code",
      "game-code",
      "quick",
      "leave",
      "start",
      "ready",
      "difficulty",
      "close",
      "profile",
    ].includes(String(body.action))
  )
    return null;
  const action = body.action as
    | "create"
    | "join"
    | "join-code"
    | "game-code"
    | "quick"
    | "leave"
    | "start"
    | "ready"
    | "difficulty"
    | "close"
    | "profile";
  const favoriteFactions =
    action === "profile" ? parseFavoriteFactions(body.favoriteFactions) : [];
  const portrait = body.portrait === undefined ? "default" : body.portrait;
  if (action === "profile" && !isDefensePortrait(portrait)) return null;
  const profileOwner =
    typeof body.profileOwner === "string" && body.profileOwner.length <= 128
      ? body.profileOwner
      : "";
  if (favoriteFactions === null || (action === "profile" && !profileOwner))
    return null;
  if (action === "profile" && !validCoreBondSelection(favoriteFactions))
    return null;
  const server = body.server;
  const preferences = parseTeamPreferences({
    ...body,
    difficulty: body.difficulty ?? (action === "create" ? "ac1" : "any"),
  });
  if (!preferences || (action === "create" && preferences.difficulty === "any"))
    return null;
  if (action === "difficulty" && preferences.difficulty === "any") return null;
  const bondPreferences = parseBondMatchPreferences(
    action === "quick" ? body : {},
  );
  if (!bondPreferences) return null;
  if (
    action === "quick" &&
    !bondPreferences.useProfileBonds &&
    !validCoreBondSelection(bondPreferences.preferredBonds)
  )
    return null;
  if (
    (action === "create" || action === "quick" || action === "join-code") &&
    server !== "official" &&
    server !== "bilibili"
  )
    return null;
  const clean = (key: string, max: number) =>
    typeof body[key] === "string" && body[key].trim().length <= max
      ? body[key].trim()
      : "";
  const title = clean("title", 40),
    roomCode = clean("roomCode", 40),
    note = clean("note", 160),
    roomId = clean("roomId", 64),
    inviteCode = clean("inviteCode", 64);
  if (
    ((action === "create" && body.roomCode !== undefined) ||
      action === "game-code") &&
    (typeof body.roomCode !== "string" || body.roomCode.trim().length > 40)
  )
    return null;
  if (
    action === "create" &&
    (!title ||
      (body.note !== undefined &&
        (typeof body.note !== "string" || body.note.length > 160)))
  )
    return null;
  if (
    ["join", "start", "close", "ready", "difficulty", "game-code"].includes(
      action,
    ) &&
    !roomId
  )
    return null;
  if (action === "ready" && typeof body.isReady !== "boolean") return null;
  if (action === "join-code" && !inviteCode) return null;
  return {
    action,
    server: server as GameServer,
    title,
    roomCode,
    note,
    roomId,
    inviteCode,
    favoriteFactions,
    profileOwner,
    portrait: portrait as DefensePortrait,
    isReady: body.isReady === true,
    ...preferences,
    ...bondPreferences,
  };
}
