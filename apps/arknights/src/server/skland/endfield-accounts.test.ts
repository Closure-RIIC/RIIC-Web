import assert from "node:assert/strict";
import test from "node:test";
import { PRIVACY_VERSION, TERMS_VERSION } from "../../../../../packages/platform/legal-policy.ts";
import { createSklandStoredAccount, sealOwnedSklandAccount, websiteUserOwnerTag, type SklandSessionPayload } from "./session.ts";
import { endfieldCookieName, ENDFIELD_SKLAND_COOKIE, readEndfieldAccounts, upsertEndfieldAccount } from "./endfield-accounts.ts";

test("Endfield accounts keep independent logins, enforce ownership/limit and retain legacy sessions", context => {
  const original = process.env.SKLAND_SESSION_SECRET;
  process.env.SKLAND_SESSION_SECRET = "endfield-account-test-secret-0123456789";
  context.after(() => { if (original === undefined) delete process.env.SKLAND_SESSION_SECRET; else process.env.SKLAND_SESSION_SECRET = original; });
  const session: SklandSessionPayload = {
    version: 3, userId: "one", cred: "cred", token: "token", dId: "device", selectedUid: "",
    refreshedAt: Date.now(), expiresAt: Date.now() + 3600000,
    policyConsent: { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, acceptedAt: Date.now() },
  };
  const roles = [{ uid: "uid", roleId: "role", serverId: "server", nickname: "Test", serverName: "Test", isDefault: true }];
  const legacy = createSklandStoredAccount(session, [{ uid: "role", nickname: "Test", channelName: "Test", isDefault: true }], "endfield-direct");
  const cookies: Record<string, string> = { [ENDFIELD_SKLAND_COOKIE]: sealOwnedSklandAccount(legacy, websiteUserOwnerTag("owner")) };
  const accounts = readEndfieldAccounts(cookies, "owner");
  assert.deepEqual(accounts, [legacy]);
  assert.deepEqual(readEndfieldAccounts(cookies, "someone-else"), []);
  const second = upsertEndfieldAccount(accounts, { ...session, userId: "two" }, roles);
  accounts.push(second);
  assert.notEqual(second.accountId, legacy.accountId);
  cookies[endfieldCookieName(second.accountId)] = sealOwnedSklandAccount(second, websiteUserOwnerTag("owner"));
  assert.equal(readEndfieldAccounts(cookies, "owner").length, 2);
  assert.equal(upsertEndfieldAccount(accounts, { ...session, token: "updated" }, roles).accountId, legacy.accountId);
  assert.equal(legacy.session.token, "token", "Existing account is not mutated");
  for (let i = 3; i <= 5; i++) accounts.push(upsertEndfieldAccount(accounts, { ...session, userId: String(i) }, roles));
  assert.throws(() => upsertEndfieldAccount(accounts, { ...session, userId: "six" }, roles), /最多/);
  assert.equal(upsertEndfieldAccount(accounts, { ...session, userId: "two" }, roles).accountId, second.accountId, "Reauthorization works at the limit");
  delete cookies[ENDFIELD_SKLAND_COOKIE];
  assert.deepEqual(readEndfieldAccounts(cookies, "owner").map(account => account.accountId), [second.accountId]);
  cookies[ENDFIELD_SKLAND_COOKIE] = cookies[endfieldCookieName(second.accountId)];
  assert.equal(readEndfieldAccounts(cookies, "owner").length, 1, "Renamed cookies cannot impersonate the legacy account");
});
