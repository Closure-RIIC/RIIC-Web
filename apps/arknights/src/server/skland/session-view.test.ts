import assert from "node:assert/strict";
import test from "node:test";

import type { SklandAccountSummary, SklandBindingSummary } from "../../types.ts";
import { resolveSklandSessionView, sklandSessionMode } from "./session-view.ts";

const account: SklandAccountSummary = {
  accountId: "account_public",
  selectedUid: "role-public",
  roles: [{ uid: "role-public", nickname: "公开博士", channelName: "官服", isDefault: true }],
  credentialExpiresAt: 1_800_000_000_000,
};

const bindingSummary: SklandBindingSummary = {
  totalCount: 1,
  activeCount: 1,
  renewalDueCount: 0,
  nextExpiresAt: account.credentialExpiresAt,
  latestExpiredAt: null,
};

test("accepts only the absent or summary session mode", () => {
  assert.equal(sklandSessionMode("https://example.test/api/skland/session"), "full");
  assert.equal(sklandSessionMode("https://example.test/api/skland/session?mode=summary"), "summary");
  for (const url of [
    "https://example.test/api/skland/session?mode=full",
    "https://example.test/api/skland/session?mode=",
    "https://example.test/api/skland/session?mode=summary&mode=summary",
  ]) {
    assert.throws(() => sklandSessionMode(url), (error: unknown) => (
      Boolean(error && typeof error === "object" && "code" in error && error.code === "AIC-REQ-1001")
    ));
  }
});

test("summary returns only identity and binding fields without loading upstream snapshots", async () => {
  let fullLoads = 0;
  const store = { accounts: [account], activeAccountId: account.accountId, privateCredential: "must-not-leak" };
  const resolved = await resolveSklandSessionView({
    mode: "summary",
    store,
    bindingSummary,
    accountSummaries: (value) => value.accounts,
    activeAccountId: (value) => value.activeAccountId,
    loadFull: async (value) => {
      fullLoads += 1;
      return { store: value, snapshot: null, statusSnapshot: null };
    },
  });

  assert.equal(fullLoads, 0);
  assert.equal(resolved.refreshed, false);
  assert.equal(resolved.data.authenticated, true);
  assert.deepEqual(resolved.data.authMethods, { qr: true, credential: true });
  assert.deepEqual(Object.keys(resolved.data).sort(), [
    "accounts",
    "activeAccountId",
    "authMethods",
    "authenticated",
    "bindingCount",
    "bindingSummary",
    "configured",
  ]);
  assert.equal("scheduleSnapshot" in resolved.data, false);
  assert.equal("statusSnapshot" in resolved.data, false);
  assert.equal(JSON.stringify(resolved.data).includes("must-not-leak"), false);
});

test("summary preserves an empty binding state without inventing an authenticated account", async () => {
  const emptyBindings = { ...bindingSummary, totalCount: 0, activeCount: 0, nextExpiresAt: null };
  const store = { accounts: [] as SklandAccountSummary[], activeAccountId: null as string | null };
  const resolved = await resolveSklandSessionView({
    mode: "summary",
    store,
    bindingSummary: emptyBindings,
    accountSummaries: (value) => value.accounts,
    activeAccountId: (value) => value.activeAccountId,
    loadFull: async (value) => ({ store: value, snapshot: null, statusSnapshot: null }),
  });

  assert.equal(resolved.data.authenticated, false);
  assert.equal(resolved.data.bindingCount, 0);
  assert.deepEqual(resolved.data.accounts, []);
  assert.equal(resolved.data.activeAccountId, null);
});
