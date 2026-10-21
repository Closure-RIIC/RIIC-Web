import assert from "node:assert/strict";
import test from "node:test";
import { refreshSklandTraining, trainingInputKey, trainingSyncDue, type TrainingData, type TrainingInput } from "./skland-training-sync.ts";
import type { SklandSessionData } from "./types.ts";

const input: TrainingInput = {
  identity: "website:account:uid",
  layout: { template: "243", drone_cap: 0, scenario: {}, rooms: [] },
  operbox: [{ id: "char_1", name: "能天使", own: true, elite: 1, level: 50, potential: 1, rarity: 6 }],
  rotation: "abc_12_6_6",
  fiammettaEnabled: false,
};
const data: TrainingData = { profile: {
  schema_version: 4, layout_label: "243", operbox_label: "Skland", baseline_label: "test",
  summary: { owned: 1, tier_up_owned: 1, trade_pool_ready: 1 },
  domains: [], rotation: {}, baseline_rotation: {}, actions: [], flags: [], narration_hints: [],
} };
function session(operbox = input.operbox): SklandSessionData {
  return {
    authenticated: true, configured: true,
    activeAccountId: "account",
    accounts: [{ accountId: "account", selectedUid: "uid", roles: [], credentialExpiresAt: 1 }],
    scheduleSnapshot: {
      operbox, roles: [], sourceName: "Skland", warnings: [],
      infrastructure: { rooms: [], tiredOperators: [], layoutSuggestion: null },
    },
  } as unknown as SklandSessionData;
}
const effects = {
  accountId: "account", uid: "uid", sync: async () => session(), isCurrent: () => true,
  cached: null, compute: async () => data,
};

test("fresh progression is passed to the solver and only advice is returned", async () => {
  const upgraded = [{ ...input.operbox[0], elite: 2, level: 90 }];
  const result = await refreshSklandTraining(input, {
    ...effects, sync: async () => session(upgraded),
    compute: async (operbox, source) => {
      assert.deepEqual(operbox, upgraded);
      assert.equal(source, "Skland");
      return data;
    },
  });
  assert.equal(result?.data, data);
  assert.equal(result?.key, trainingInputKey({ ...input, operbox: upgraded }));
  assert.equal(result?.error, null);
});

test("unchanged progression reuses advice even when upstream order changes", async () => {
  const other = { ...input.operbox[0], id: "char_2", name: "银灰" };
  const original = { ...input, operbox: [...input.operbox, other] };
  const result = await refreshSklandTraining(original, {
    ...effects, sync: async () => session([...original.operbox].reverse()),
    cached: { key: trainingInputKey(original), data },
    compute: async () => { assert.fail("unchanged data must not submit another solver request"); },
  });
  assert.equal(result?.data, data);
});

test("identity, progression, ownership, layout and rotation invalidate advice", () => {
  const original = trainingInputKey(input);
  for (const variant of [
    { ...input, identity: "other" },
    { ...input, operbox: [{ ...input.operbox[0], elite: 2 }] },
    { ...input, operbox: [{ ...input.operbox[0], level: 51 }] },
    { ...input, operbox: [{ ...input.operbox[0], own: false }] },
    { ...input, layout: { ...input.layout, drone_cap: 100 } },
    { ...input, rotation: "abc_12_12_12" as const },
  ]) assert.notEqual(trainingInputKey(variant), original);
});

test("automatic, manual and Retry-After cooldowns are all respected", () => {
  assert.equal(trainingSyncDue(0, null, 0, false), true);
  assert.equal(trainingSyncDue(299_999, 0, 0, false), false);
  assert.equal(trainingSyncDue(300_000, 0, 0, false), true);
  assert.equal(trainingSyncDue(29_999, 0, 0, true), false);
  assert.equal(trainingSyncDue(30_000, 0, 0, true), true);
  assert.equal(trainingSyncDue(300_000, 0, 600_000, true), false);
});

test("account or role changes returned by sync never update another box", async () => {
  for (const changed of [
    { ...session(), activeAccountId: "other" },
    { ...session(), accounts: [{ ...session().accounts[0], selectedUid: "other" }] },
    { ...session(), authenticated: false },
  ]) await assert.rejects(refreshSklandTraining(input, {
    ...effects, sync: async () => changed,
    compute: async () => { assert.fail("must not compute for another account"); },
  }), /SKLAND_TRAINING_ACCOUNT_CHANGED/);
});

test("stale sync responses do not start a solver request", async () => {
  assert.equal(await refreshSklandTraining(input, {
    ...effects, isCurrent: () => false,
    compute: async () => { assert.fail("must not compute after source switch or logout"); },
  }), null);
});

test("stale solver responses cannot replace advice after a context switch", async () => {
  let current = true;
  assert.equal(await refreshSklandTraining(input, {
    ...effects, isCurrent: () => current,
    compute: async () => { current = false; return data; },
  }), null);
});

test("solver failure still returns synced progression with an explicit error", async () => {
  const failure = new Error("solver unavailable");
  const result = await refreshSklandTraining(input, {
    ...effects, compute: async () => { throw failure; },
  });
  assert.equal(result?.error, failure);
  assert.equal(result?.data, null);
  assert.deepEqual(result?.operbox, input.operbox);
});

test("upstream failure leaves existing data untouched", async () => {
  await assert.rejects(refreshSklandTraining(input, {
    ...effects, sync: async () => { throw new Error("upstream failed"); },
    compute: async () => { assert.fail("must not compute after sync failure"); },
  }), /upstream failed/);
});
