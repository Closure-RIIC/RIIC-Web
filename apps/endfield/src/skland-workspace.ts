import { catalog, nonSchedulableOperators, parseRoster, type Workspace } from "@riic/endfield-solver/model.mjs";
import { endfieldFacilityLevels, matchEndfieldRoster, type EndfieldRole, type EndfieldSnapshot } from "@riic/endfield-skland/model";
import { withFacilityLevels } from "./scheduling-options.ts";

/** Non-secret identity only. A partial response may only extend its own saved roster. */
export function sklandRosterSource(ownerKey: string, accountId: string, role: Pick<EndfieldRole, "serverId" | "roleId">): string {
  return JSON.stringify([ownerKey, accountId, role.serverId, role.roleId]);
}

export function syncSklandWorkspace(current: Workspace, snapshot: EndfieldSnapshot, source: string, roleId: string) {
  if (snapshot.role.roleId !== roleId) throw new Error("森空岛返回的角色不匹配，请重新同步。 / Skland returned a different character; please retry.");
  const matched = matchEndfieldRoster(snapshot, catalog, nonSchedulableOperators);
  // parseRoster carries `latestSpaceshipSkillNodes`（每槽最高档）next to `elite`.
  const incoming = matched.operators.length ? parseRoster(matched.operators) : [];
  const sameSource = current.rosterSource === source;
  const partial = snapshot.rosterComplete === false;
  const levels = endfieldFacilityLevels(snapshot);
  const blocked = partial && !sameSource ? "partial" : !incoming.length && matched.unsupported.length ? "unsupported" : null;
  const status = { count: incoming.length, partial, blocked, facilitiesApplied: !!levels && !blocked, unsupported: matched.unsupported, excluded: matched.excluded };
  // Keep the entire previous setup together when the new identity cannot provide a usable roster.
  if (blocked) return { workspace: current, status };
  const byName = new Map(incoming.map(op => [op.name, op]));
  const operators = sameSource ? current.operators.flatMap(op => {
    const synced = byName.get(op.name);
    byName.delete(op.name);
    return synced ? [synced] : partial ? [op] : [];
  }) : [];
  operators.push(...byName.values());
  const { manual, ...base } = current;
  return {
    workspace: { ...base, operators, options: levels ? withFacilityLevels(current.options, levels) : current.options, rosterSource: source,
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
