import { endfieldRolesFromBinding, normalizeEndfieldSnapshot, EndfieldDataError, type EndfieldRole } from "@riic/endfield-skland/model";
import { consumeScan, pollSklandIdentity, startScan, withSklandSession, withSklandCredential, SklandServiceError } from "./adapter";
import type { SklandPolicyConsentRequest } from "@riic/platform/legal-policy";
import type { SklandPolicyConsent, SklandSessionPayload } from "./session";
import { readEndfieldCalculatorData, type EndfieldInventoryClient } from "./endfield-inventory.ts";
import { createSnapshotCache, SnapshotCapacityError } from "../snapshot-cache";
import { createHash } from "node:crypto";

const snapshots = createSnapshotCache<{ session: SklandSessionPayload; result: Awaited<ReturnType<typeof readEndfieldSnapshot>> }>();
export const invalidateEndfieldSnapshots = snapshots.invalidateOwner;

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
  // Hold the admission slot until every parallel read settles, including after a detail failure.
  const [details, calculator] = await Promise.allSettled([
    client.collections.player.getEndfieldDetails({ roleId: role.roleId, serverId: role.serverId }),
    readEndfieldCalculatorData(client, role),
  ]);
  if (details.status === "rejected") throw details.reason;
  if (calculator.status === "rejected") throw calculator.reason;
  const snapshot = normalizeEndfieldSnapshot(details.value);
  if (snapshot.role.roleId !== role.roleId) throw new EndfieldDataError("返回的角色与选择不一致，请重新同步。");
  return { ...snapshot, ...calculator.value };
}

export async function endfieldSync(session: SklandSessionPayload, selected: Pick<EndfieldRole, "roleId" | "serverId">, identity?: { userId: string; accountId: string; force?: boolean }) {
  // Coalesce credential refresh too, before taking an upstream admission slot.
  const load = () => withSklandSession(session, client => readEndfieldSnapshot(client, selected));
  if (!identity) return load();
  try {
    return await snapshots.read({
      userId: identity.userId, game: "endfield", accountId: `${identity.accountId}:${createHash("sha256").update(session.cred).update("\0").update(session.token).digest("hex")}`,
      serverId: selected.serverId, roleId: selected.roleId, version: 1,
    }, load, identity.force);
  } catch (error) {
    if (error instanceof SnapshotCapacityError) throw new SklandServiceError("RATE_LIMITED", "森空岛同步繁忙，请稍后再试。", 429);
    throw error;
  }
}
