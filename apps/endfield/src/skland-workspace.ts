import { parseRoster, type Operator, type Workspace } from "@riic/endfield-solver/model.mjs";
import type { DisplayOperator } from "@riic/endfield-data";
import { endfieldFacilityLevels, matchEndfieldRoster, type EndfieldRole, type EndfieldSnapshot } from "@riic/endfield-skland/model";
import { withFacilityLevels } from "./scheduling-options.ts";

/** Non-secret identity only. A partial response may only extend its own saved roster. */
export function sklandRosterSource(ownerKey: string, accountId: string, role: Pick<EndfieldRole, "serverId" | "roleId">): string {
  return JSON.stringify([ownerKey, accountId, role.serverId, role.roleId]);
}

function mergeRoster(previous: Operator[], incoming: Operator[], partial: boolean): Operator[] {
  const byName = new Map(incoming.map(op => [op.name, op]));
  const operators = previous.flatMap(op => {
    const synced = byName.get(op.name);
    byName.delete(op.name);
    return synced ? [synced] : partial ? [op] : [];
  });
  return structuredClone([...operators, ...byName.values()]);
}

/** Restore roster progression only; keep facilities and prune unavailable manual slots. */
export function restoreSklandRoster(current: Workspace): Workspace {
  if (!current.rosterSource || !current.sklandRoster) return current;
  const operators = structuredClone(current.sklandRoster);
  const owned = new Set(operators.map(op => op.name));
  const manual = current.manual?.map(room => ({ ...room,
    a: room.a.map(name => owned.has(name) ? name : ""), b: room.b.map(name => owned.has(name) ? name : ""),
  }));
  return { ...current, operators, ...(manual ? { manual } : {}) };
}

/** catalog.json 是干员名单的唯一来源；没有基建技能的（如管理员）单独分组，避免被排进班次。 */
export function rosterMatchTables(catalog: readonly DisplayOperator[]) {
  const toEntry = (op: DisplayOperator) => ({ id: op.id, name: op.name });
  return {
    schedulable: catalog.filter(op => op.skills.length > 0).map(toEntry),
    nonSchedulable: catalog.filter(op => op.skills.length === 0).map(toEntry),
  };
}

export function syncSklandWorkspace(current: Workspace, snapshot: EndfieldSnapshot, source: string, roleId: string,
  catalog: readonly DisplayOperator[]) {
  if (snapshot.role.roleId !== roleId) throw new Error("森空岛返回的角色不匹配，请重新同步。 / Skland returned a different character; please retry.");
  const { schedulable, nonSchedulable } = rosterMatchTables(catalog);
  const matched = matchEndfieldRoster(snapshot, schedulable, nonSchedulable);
  // parseRoster carries `latestSpaceshipSkillNodes`（每槽最高档）next to `elite`.
  const incoming = matched.operators.length ? parseRoster(matched.operators) : [];
  const sameSource = current.rosterSource === source;
  const partial = snapshot.rosterComplete === false;
  const levels = endfieldFacilityLevels(snapshot);
  const blocked = partial && !sameSource ? "partial" : !incoming.length && matched.unsupported.length ? "unsupported" : null;
  const status = { count: incoming.length, partial, blocked, facilitiesApplied: !!levels && !blocked, unsupported: matched.unsupported, excluded: matched.excluded };
  // Keep the entire previous setup together when the new identity cannot provide a usable roster.
  if (blocked) return { workspace: current, status };
  const { manual, sklandRoster: previousSnapshot, ...base } = current;
  // Partial responses can update a real baseline, never promote a manually edited roster to one.
  const sklandRoster = !partial || sameSource && previousSnapshot
    ? mergeRoster(sameSource ? previousSnapshot ?? [] : [], incoming, partial) : undefined;
  const operators = mergeRoster(sameSource ? previousSnapshot ?? current.operators : [], incoming, partial);
  return {
    workspace: { ...base, operators, options: levels ? withFacilityLevels(current.options, levels) : current.options, rosterSource: source,
      ...(sklandRoster ? { sklandRoster } : {}),
      ...(sameSource && manual ? { manual } : {}) },
    status,
  };
}

export type SklandSyncStatus = ReturnType<typeof syncSklandWorkspace>["status"];

export type SklandSyncActivity = {
  id: number;
  kind: "skland";
  phase: "success" | "warning";
  status: SklandSyncStatus;
};
