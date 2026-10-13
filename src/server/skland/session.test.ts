import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSameOrigin,
  createSklandStoredAccount,
  removeSklandAccount,
  sealSklandAccount,
  sealOwnedSklandAccount,
  sealSklandAccountIndex,
  sealSklandSession,
  sklandDataOwnerTag,
  sklandBindingKey,
  SKLAND_ACCOUNT_COOKIE_PREFIX,
  SKLAND_ACCOUNT_INDEX_COOKIE,
  SKLAND_ACCOUNT_LIMIT,
  SKLAND_SESSION_TTL_SECONDS,
  type SklandSessionPayload,
  type SklandStoredAccount,
  toPublicSklandAccount,
  unsealSklandAccount,
  unsealOwnedSklandAccount,
  unsealSklandAccountIndex,
  unsealSklandSession,
  upsertSklandAccount,
  websiteUserOwnerTag,
} from "./session.ts";
import { isCurrentPolicyConsent, PRIVACY_VERSION, TERMS_VERSION } from "../../legal-policy.ts";

const secret = "test-secret-that-is-at-least-thirty-two-bytes";
const now = 1_700_000_000_000;

test("credential retention is fixed at seven days", () => {
  assert.equal(SKLAND_SESSION_TTL_SECONDS, 7 * 24 * 60 * 60);
  assert.match(SKLAND_ACCOUNT_INDEX_COOKIE, /_v3$/);
  assert.match(SKLAND_ACCOUNT_COOKIE_PREFIX, /_v3_$/);
});

function sessionFor(userId: string, selectedUid = `${userId}-uid`): SklandSessionPayload {
  return {
    version: 3,
    cred: `cred-${userId}`,
    token: `token-${userId}`,
    dId: `did-${userId}`,
    userId,
    selectedUid,
    refreshedAt: now,
    expiresAt: now + 60_000,
    policyConsent: {
      termsVersion: TERMS_VERSION,
      privacyVersion: PRIVACY_VERSION,
      acceptedAt: now,
    },
  };
}

function rolesFor(userId: string) {
  return [{
    uid: `${userId}-uid`,
    nickname: `博士-${userId}`,
    channelName: "官服",
    isDefault: true,
  }];
}

test("round-trips legacy, account, and account-index encrypted payloads", () => {
  const session = sessionFor("one");
  assert.deepEqual(unsealSklandSession(sealSklandSession(session, secret), secret, now), session);

  const account = createSklandStoredAccount(session, rolesFor("one"), "account_one");
  assert.deepEqual(unsealSklandAccount(sealSklandAccount(account, secret), secret, now), account);

  const index = {
    version: 3 as const,
    accountIds: [account.accountId],
    activeAccountId: account.accountId,
    expiresAt: now + 60_000,
  };
  assert.deepEqual(unsealSklandAccountIndex(sealSklandAccountIndex(index, secret), secret, now), index);
});

test("account OAuth survives encrypted login restoration beyond one hour without leaking to public data", () => {
  const session = { ...sessionFor("one"), accountOAuthToken: "private-hg-account-token", expiresAt: now + SKLAND_SESSION_TTL_SECONDS * 1000 };
  const account = createSklandStoredAccount(session, rolesFor("one"), "account_one");
  const owner = websiteUserOwnerTag("website-one", secret);
  const sealed = sealOwnedSklandAccount(account, owner, secret);
  assert.equal(sealed.includes(session.accountOAuthToken), false);
  assert.deepEqual(unsealOwnedSklandAccount(sealed, owner, secret, now + 2 * 60 * 60_000), account);
  assert.equal(unsealOwnedSklandAccount(sealed, websiteUserOwnerTag("website-two", secret), secret, now), null);
  assert.equal(unsealOwnedSklandAccount(sealed, owner, secret, session.expiresAt), null);
  assert.equal(JSON.stringify(toPublicSklandAccount(account)).includes(session.accountOAuthToken), false);
  for (const accountOAuthToken of ["", " ", 123, null]) {
    const invalid = { ...session, accountOAuthToken } as unknown as SklandSessionPayload;
    assert.equal(unsealSklandSession(sealSklandSession(invalid, secret), secret, now), null);
  }
});

test("re-login replaces the same Skland account without changing its opaque id or order", () => {
  const first = upsertSklandAccount([], sessionFor("one"), rolesFor("one"));
  const secondAccount = upsertSklandAccount(first.accounts, sessionFor("two"), rolesFor("two"));
  const refreshed = upsertSklandAccount(
    secondAccount.accounts,
    { ...sessionFor("one"), token: "new-token" },
    [{ ...rolesFor("one")[0], nickname: "更新后的博士" }]
  );

  assert.equal(refreshed.replaced, true);
  assert.equal(refreshed.accounts.length, 2);
  assert.equal(refreshed.account.accountId, first.account.accountId);
  assert.equal(refreshed.accounts[0].session.token, "new-token");
  assert.equal(refreshed.accounts[0].roles[0].nickname, "更新后的博士");
  assert.equal(refreshed.accounts[1].accountId, secondAccount.account.accountId);
});

test("public account summaries recursively exclude every credential and upstream account id", () => {
  const account = createSklandStoredAccount(
    sessionFor("upstream-secret", "public-role"),
    [{ uid: "public-role", nickname: "公开博士", channelName: "官服", isDefault: true }],
    "account_public"
  );
  const serialized = JSON.stringify(toPublicSklandAccount(account));
  for (const sensitive of ["cred-", "token-", "did-", "upstream-secret"]) {
    assert.equal(serialized.includes(sensitive), false);
  }
  assert.deepEqual(Object.keys(toPublicSklandAccount(account)).sort(), [
    "accountId",
    "credentialExpiresAt",
    "roles",
    "selectedUid",
  ]);
});

test("legacy split-consent sessions are rejected after status access becomes part of login", () => {
  const legacy = { ...sessionFor("legacy"), version: 2, statusConsent: null };
  assert.equal(
    unsealSklandSession(
      sealSklandSession(legacy as unknown as SklandSessionPayload, secret),
      secret,
      now
    ),
    null
  );
});

test("data owner tags are deterministic, account-specific, and do not reveal the upstream id", () => {
  const first = sklandDataOwnerTag("upstream-user-one", secret);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, sklandDataOwnerTag("upstream-user-one", secret));
  assert.notEqual(first, sklandDataOwnerTag("upstream-user-two", secret));
  assert.equal(first.includes("upstream-user-one"), false);
});

test("database binding keys use a separate HMAC domain from private run ownership", () => {
  const binding = sklandBindingKey("upstream-user", secret);
  assert.equal(binding, sklandBindingKey("upstream-user", secret));
  assert.notEqual(binding, sklandDataOwnerTag("upstream-user", secret));
  assert.equal(binding.includes("upstream-user"), false);
});

test("Skland account cookies are bound to one website user", () => {
  const account = createSklandStoredAccount(sessionFor("skland-user"), rolesFor("skland-user"), "account_owned");
  const firstOwner = websiteUserOwnerTag("website-user-one", secret);
  const secondOwner = websiteUserOwnerTag("website-user-two", secret);
  const sealed = sealOwnedSklandAccount(account, firstOwner, secret);
  assert.deepEqual(unsealOwnedSklandAccount(sealed, firstOwner, secret, now), account);
  assert.equal(unsealOwnedSklandAccount(sealed, secondOwner, secret, now), null);
  assert.equal(sealed.includes("website-user-one"), false);
});

test("expired owned account cookies cannot produce an identity summary", () => {
  const account = createSklandStoredAccount(sessionFor("expired-user"), rolesFor("expired-user"), "account_expired");
  const owner = websiteUserOwnerTag("website-user", secret);
  const sealed = sealOwnedSklandAccount(account, owner, secret);
  assert.equal(unsealOwnedSklandAccount(sealed, owner, secret, account.session.expiresAt), null);
});

test("QR consent requires both current policy versions", () => {
  const valid = {
    termsAccepted: true as const,
    privacyAccepted: true as const,
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION,
  };
  assert.equal(isCurrentPolicyConsent(valid), true);
  assert.equal(isCurrentPolicyConsent({ ...valid, privacyAccepted: false }), false);
  assert.equal(isCurrentPolicyConsent({ ...valid, termsVersion: "old" }), false);
  assert.equal(isCurrentPolicyConsent({ ...valid, privacyVersion: "2026-08-27-detailed-telemetry" }), false);
  const oldPolicySession = {
    ...sessionFor("old-policy"),
    policyConsent: {
      ...sessionFor("old-policy").policyConsent,
      privacyVersion: "2026-08-27-detailed-telemetry",
    },
  } as unknown as SklandSessionPayload;
  assert.equal(unsealSklandSession(sealSklandSession(oldPolicySession, secret), secret, now), null);
});

test("enforces the five-account limit while still allowing an existing account to refresh", () => {
  let accounts: SklandStoredAccount[] = [];
  for (let index = 0; index < SKLAND_ACCOUNT_LIMIT; index += 1) {
    accounts = upsertSklandAccount(accounts, sessionFor(String(index)), rolesFor(String(index))).accounts;
  }
  assert.equal(accounts.length, SKLAND_ACCOUNT_LIMIT);
  assert.throws(
    () => upsertSklandAccount(accounts, sessionFor("overflow"), rolesFor("overflow")),
    /最多可登录 5 个/
  );
  assert.doesNotThrow(() => upsertSklandAccount(accounts, sessionFor("0"), rolesFor("0")));
});

test("removing the active account selects the next account and falls back to the previous at the end", () => {
  const accounts = ["one", "two", "three"].map((userId) =>
    createSklandStoredAccount(sessionFor(userId), rolesFor(userId), `account_${userId}`)
  );
  const middle = removeSklandAccount(accounts, "account_two", "account_two");
  assert.equal(middle.activeAccountId, "account_three");
  const last = removeSklandAccount(accounts, "account_three", "account_three");
  assert.equal(last.activeAccountId, "account_two");
});

function proxiedRequest(origin?: string, forwardedHost = "beta.example.com:4174", forwardedProto = "http"): Request {
  const headers = new Headers({
    host: "127.0.0.1:4175",
    "x-forwarded-host": forwardedHost,
    "x-forwarded-proto": forwardedProto,
  });
  if (origin) headers.set("origin", origin);
  return new Request("http://127.0.0.1:4175/api/skland/auth/qr", { method: "POST", headers });
}

test("allows requests without an Origin header", () => {
  assert.doesNotThrow(() => assertSameOrigin(proxiedRequest(), "http://beta.example.com:4174"));
});

test("uses the configured public origin instead of the internal proxy address", () => {
  const request = proxiedRequest("http://beta.example.com:4174", "beta.example.com");
  assert.doesNotThrow(() => assertSameOrigin(request, "http://beta.example.com:4174"));
});

test("rejects a different public port", () => {
  const request = proxiedRequest("http://beta.example.com");
  assert.throws(() => assertSameOrigin(request, "http://beta.example.com:4174"), /请求来源无效/);
});

test("rejects a different public scheme or host", () => {
  for (const origin of ["https://beta.example.com:4174", "http://other.example.com:4174"]) {
    assert.throws(() => assertSameOrigin(proxiedRequest(origin), "http://beta.example.com:4174"), /请求来源无效/);
  }
});

test("rejects a malformed request origin", () => {
  assert.throws(() => assertSameOrigin(proxiedRequest("null"), "http://beta.example.com:4174"), /请求来源无效/);
});

test("rejects an invalid configured public origin", () => {
  const request = proxiedRequest("http://beta.example.com:4174");
  assert.throws(() => assertSameOrigin(request, "http://beta.example.com:4174/path"), /SKLAND_PUBLIC_ORIGIN 配置无效/);
});

test("falls back to forwarded host and protocol when no public origin is configured", () => {
  const request = proxiedRequest("https://beta.example.com", "beta.example.com", "https");
  assert.doesNotThrow(() => assertSameOrigin(request, ""));
});

test("rejects a forwarded protocol mismatch", () => {
  const request = proxiedRequest("http://beta.example.com:4174", "beta.example.com:4174", "https");
  assert.throws(() => assertSameOrigin(request, ""), /请求来源无效/);
});
