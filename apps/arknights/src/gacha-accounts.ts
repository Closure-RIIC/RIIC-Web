import type { SklandAccountSummary } from "./types.ts";

export type GachaAccount = Pick<SklandAccountSummary, "accountId" | "selectedUid" | "roles">;
export type GachaSessionData = {
  accounts: GachaAccount[];
  roles: Array<{ uid: string; nickname: string }>;
  authorizedUids: string[];
};

export function gachaAccountOptions(skland: GachaAccount[], archives: Array<{ uid: string; nickname: string }>, authorized: Array<{ uid: string; nickname: string }>): GachaSessionData {
  const accounts = skland.map((account) => ({ ...account, roles: [...account.roles] }));
  const known = new Set(accounts.flatMap((account) => account.roles.map((role) => role.uid)));
  for (const role of [...archives, ...authorized]) {
    if (known.has(role.uid)) continue;
    known.add(role.uid);
    accounts.push({ accountId: `archive-${role.uid}`, selectedUid: role.uid,
      roles: [{ ...role, channelName: "明日方舟", isDefault: true }] });
  }
  return { accounts, roles: accounts.flatMap((account) => account.roles.map(({ uid, nickname }) => ({ uid, nickname }))), authorizedUids: authorized.map((role) => role.uid) };
}
