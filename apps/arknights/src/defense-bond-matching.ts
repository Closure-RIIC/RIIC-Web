import {
  DEFENSE_CORE_BONDS,
  type DefenseFaction,
  type BondMatchPreferences,
} from "./defense-team-validation";

export type BondMember = { favoriteFactions: DefenseFaction[] };
const core = new Set<string>(DEFENSE_CORE_BONDS);
const weight = (bond: string) => (core.has(bond) ? 2 : 1);

/** Weighted Jaccard; many optional add-ons cannot dilute a shared core as easily. */
export function bondOverlap(
  a: readonly DefenseFaction[],
  b: readonly DefenseFaction[],
) {
  const left = new Set(a),
    right = new Set(b),
    union = new Set([...left, ...right]);
  let common = 0,
    total = 0;
  for (const bond of union) {
    total += weight(bond);
    if (left.has(bond) && right.has(bond)) common += weight(bond);
  }
  return total ? common / total : null;
}

export function matchesRequiredBonds(
  members: readonly BondMember[],
  prefs: BondMatchPreferences,
) {
  const present = new Set(members.flatMap((member) => member.favoriteFactions));
  return (
    (!prefs.requiredCoreBonds.length ||
      prefs.requiredCoreBonds.some((b) => present.has(b))) &&
    (!prefs.requiredAddonBonds.length ||
      prefs.requiredAddonBonds.some((b) => present.has(b)))
  );
}

export function bondCompatibility(
  mine: readonly DefenseFaction[],
  members: readonly BondMember[],
) {
  const known = members.filter((m) => m.favoriteFactions.length > 0);
  const overlaps = mine.length
    ? known.map((m) => bondOverlap(mine, m.favoriteFactions)!)
    : [];
  const present = new Set(members.flatMap((m) => m.favoriteFactions));
  const shared = mine.filter((b) => present.has(b));
  const complementary = [...present].filter((b) => !mine.includes(b));
  const counts = new Map<DefenseFaction, number>();
  for (const choices of [mine, ...members.map((m) => m.favoriteFactions)])
    for (const bond of new Set(choices))
      counts.set(bond, (counts.get(bond) ?? 0) + 1);
  const teamRepeat = [...counts]
    .filter(([, count]) => count > 1)
    .map(([bond]) => bond);
  if (!overlaps.length)
    return {
      score: null,
      penalty: 0.5,
      shared,
      complementary,
      teamRepeat,
      known: known.length,
      total: members.length,
    };
  // Compare every pair in the prospective team, not just the incoming player's pairs.
  for (let i = 0; i < known.length; i++)
    for (let j = i + 1; j < known.length; j++)
      overlaps.push(
        bondOverlap(known[i].favoriteFactions, known[j].favoriteFactions)!,
      );
  // The worst pair matters more than the average; unknown pairs remain neutral.
  const max = Math.max(...overlaps),
    average = overlaps.reduce((a, b) => a + b, 0) / overlaps.length;
  const expectedPairs = ((members.length + 1) * members.length) / 2;
  const coverage = overlaps.length / expectedPairs;
  const penalty =
    (0.65 * max + 0.35 * average) * coverage + 0.5 * (1 - coverage);
  return {
    score: Math.round((1 - penalty) * 100),
    penalty,
    shared,
    complementary,
    teamRepeat,
    known: known.length,
    total: members.length,
  };
}
