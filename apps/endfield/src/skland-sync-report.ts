import type { Operator, Workspace } from "@riic/endfield-solver/model.mjs";
import type { SklandSyncStatus } from "./skland-workspace";

export const SYNC_FACILITY_KEYS = ["center", "mfg1", "mfg2", "grow", "guest"] as const;
export type SyncFacilityKey = (typeof SYNC_FACILITY_KEYS)[number];
const nodes = (operator: Operator) => operator.latestSpaceshipSkillNodes === undefined
  ? null : [...new Set(operator.latestSpaceshipSkillNodes)].sort();
const progression = (operator: Operator) => ({ ...operator, latestSpaceshipSkillNodes: operator.latestSpaceshipSkillNodes?.slice() });

/** Describe what was actually applied, including partial imports and decreases. Never mutates the workspace. */
export function buildSklandSyncReport(before: Workspace, after: Workspace, status: SklandSyncStatus, source: string, at = Date.now()) {
  const previous = new Map(before.operators.map(operator => [operator.name, operator]));
  const current = new Map(after.operators.map(operator => [operator.name, operator]));
  const applied = !status.blocked;
  const added = applied ? after.operators.filter(operator => !previous.has(operator.name)).map(progression) : [];
  const removed = applied ? before.operators.filter(operator => !current.has(operator.name)).map(progression) : [];
  const updated = applied ? after.operators.flatMap(operator => {
    const old = previous.get(operator.name);
    if (!old || old.elite === operator.elite && JSON.stringify(nodes(old)) === JSON.stringify(nodes(operator))) return [];
    return [{ name: operator.name, before: progression(old), after: progression(operator) }];
  }) : [];
  const facilities = applied && status.facilitiesApplied ? SYNC_FACILITY_KEYS.flatMap(key =>
    before.options.levels[key] === after.options.levels[key] ? []
      : [{ key, before: before.options.levels[key], after: after.options.levels[key] }]) : [];
  return {
    at, levels: { ...after.options.levels }, beforeCount: before.operators.length, afterCount: after.operators.length,
    accountChanged: !!before.rosterSource && before.rosterSource !== source,
    partial: status.partial, blocked: status.blocked, facilitiesApplied: status.facilitiesApplied,
    added, removed, updated, facilities,
    excluded: [...status.excluded], unsupported: [...status.unsupported],
    unchangedOperators: after.operators.length - added.length - updated.length,
    unchangedFacilities: status.facilitiesApplied ? SYNC_FACILITY_KEYS.length - facilities.length : 0,
    noChanges: applied && added.length + removed.length + updated.length + facilities.length === 0,
  };
}
export type SklandSyncReport = ReturnType<typeof buildSklandSyncReport>;
