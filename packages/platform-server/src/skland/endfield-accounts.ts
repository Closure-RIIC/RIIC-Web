import { type EndfieldRole } from "@riic/endfield-skland/model";
import { unsealOwnedSklandAccount, websiteUserOwnerTag, upsertSklandAccount, type SklandStoredAccount, type SklandSessionPayload } from "./session.ts";

export const ENDFIELD_SKLAND_COOKIE = "skland_endfield_v1";
export const ENDFIELD_ACCOUNT_PREFIX = "skland_endfield_account_v1_";
export const LEGACY_ENDFIELD_ACCOUNT = "endfield-direct";

export function endfieldCookieName(accountId: string) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(accountId)) throw new Error("终末地账号标识无效。");
  return accountId === LEGACY_ENDFIELD_ACCOUNT ? ENDFIELD_SKLAND_COOKIE : `${ENDFIELD_ACCOUNT_PREFIX}${accountId}`;
}

export function readEndfieldAccounts(cookies: Record<string, string>, owner: string): SklandStoredAccount[] {
  const accounts: SklandStoredAccount[] = [];
  const ownerTag = websiteUserOwnerTag(owner);
  for (const [name, value] of Object.entries(cookies)) {
    if (name !== ENDFIELD_SKLAND_COOKIE && !name.startsWith(ENDFIELD_ACCOUNT_PREFIX)) continue;
    const account = unsealOwnedSklandAccount(value, ownerTag);
    if (!account || endfieldCookieName(account.accountId) !== name
      || accounts.some(item => item.accountId === account.accountId || item.session.userId === account.session.userId)) continue;
    accounts.push(account);
  }
  return accounts;
}

export function upsertEndfieldAccount(accounts: SklandStoredAccount[], session: SklandSessionPayload, roles: EndfieldRole[]) {
  return upsertSklandAccount(accounts, session, roles.map(role => ({
    uid: role.roleId, nickname: role.nickname, channelName: role.serverName, isDefault: role.isDefault,
  }))).account;
}
