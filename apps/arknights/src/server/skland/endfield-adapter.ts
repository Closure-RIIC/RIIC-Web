import { endfieldRolesFromBinding, normalizeEndfieldSnapshot, EndfieldDataError, type EndfieldRole } from "../../../../../packages/endfield-skland/model.ts";
import { consumeScan, pollSklandIdentity, startScan, withSklandSession, withSklandCredential } from "./adapter";
import type { SklandPolicyConsentRequest } from "../../../../../packages/platform/legal-policy";
import type { SklandPolicyConsent, SklandSessionPayload } from "./session";
import { readEndfieldCalculatorData, type EndfieldInventoryClient } from "./endfield-inventory.ts";

const scanOwner = (owner: string) => `endfield:${owner}`;
export function startEndfieldScan(owner: string, ip: string, consent: SklandPolicyConsentRequest) {
  return startScan(scanOwner(owner), ip, consent);
}
export function consumeEndfieldScan(scanId: string, owner: string) {
  consumeScan(scanId, scanOwner(owner));
}
export async function pollEndfieldScan(scanId: string, owner: string, signal: AbortSignal) {
  const result = await pollSklandIdentity(scanId, scanOwner(owner), signal);
  if (!result.session) return { status: result.status };
  const loaded = await endfieldRoles(result.session);
  if (!loaded.result.length) throw new EndfieldDataError("该森空岛账号没有可用的终末地角色。");
  return { status: "authenticated" as const, ...loaded };
}

export async function endfieldCredential(credential: { cred: string; token: string }, consent: SklandPolicyConsent) {
  return withSklandCredential(credential, consent, async client => {
    const roles = endfieldRolesFromBinding(await client.collections.player.getBinding());
    if (!roles.length) throw new EndfieldDataError("该森空岛账号没有可用的终末地角色。");
    return roles;
  });
}

export async function endfieldRoles(session: SklandSessionPayload) {
  return withSklandSession(session, async client => endfieldRolesFromBinding(await client.collections.player.getBinding()));
}

type EndfieldReader = EndfieldInventoryClient & { collections: { player: {
  getBinding: () => Promise<unknown>;
  getEndfieldDetails: (role: { roleId: string; serverId: string }) => Promise<unknown>;
} } };
export async function readEndfieldSnapshot(client: EndfieldReader, selected: Pick<EndfieldRole, "roleId" | "serverId">) {
  // Recheck membership for each read. The browser cannot supply an arbitrary role.
  const roles = endfieldRolesFromBinding(await client.collections.player.getBinding());
  const role = roles.find(item => item.roleId === selected.roleId && item.serverId === selected.serverId);
  if (!role) throw new EndfieldDataError("该角色不属于当前森空岛账号，请重新选择。");
  const [response, calculator] = await Promise.all([
    client.collections.player.getEndfieldDetails({ roleId: role.roleId, serverId: role.serverId }),
    readEndfieldCalculatorData(client, role),
  ]);
  const snapshot = normalizeEndfieldSnapshot(response);
  if (snapshot.role.roleId !== role.roleId) throw new EndfieldDataError("返回的角色与选择不一致，请重新同步。");
  return { ...snapshot, ...calculator };
}

export async function endfieldSync(session: SklandSessionPayload, selected: Pick<EndfieldRole, "roleId" | "serverId">) {
  return withSklandSession(session, client => readEndfieldSnapshot(client, selected));
}
