import assert from "node:assert/strict";
import test from "node:test";
import { createSnapshotCache } from "./snapshot-cache.ts";

test("snapshots coalesce reads, expire, and isolate accounts, games and roles", async () => {
  let time = 0, calls = 0;
  const cache = createSnapshotCache<{ value: number }>({ ttlMs: 30, now: () => time });
  const identity = { userId: "one", game: "endfield" as const, accountId: "account", serverId: "server", roleId: "role", version: 1 };
  const load = async () => ({ value: ++calls });
  assert.deepEqual(await Promise.all([cache.read(identity, load), cache.read(identity, load)]), [{ value: 1 }, { value: 1 }]);
  const value = await cache.read(identity, load); value.value = 999;
  assert.deepEqual(await cache.read(identity, load), { value: 1 });
  assert.equal((await cache.read({ ...identity, userId: "two" }, load)).value, 2);
  assert.equal((await cache.read({ ...identity, game: "arknights" }, load)).value, 3);
  assert.equal((await cache.read({ ...identity, roleId: "other" }, load)).value, 4);
  time = 31;
  assert.equal((await cache.read(identity, load)).value, 5);
  cache.invalidateOwner("one");
  assert.equal((await cache.read(identity, load)).value, 6);
  assert.equal((await cache.read(identity, load, true)).value, 7);
});


test("a full cache evicts completed values and still coalesces forced reads", async () => {
  const cache = createSnapshotCache<number>({ maxEntries: 100 });
  const identity = { userId: "owner", game: "endfield" as const, accountId: "account", serverId: "server", roleId: "role", version: 1 };
  for (let index = 0; index < 100; index++) await cache.read({ ...identity, userId: String(index) }, async () => index);
  let calls = 0, finish!: (value: number) => void;
  const load = () => { calls++; return new Promise<number>(resolve => { finish = resolve; }); };
  const pending = Array.from({ length: 20 }, () => cache.read(identity, load, true));
  await Promise.resolve();
  assert.equal(calls, 1);
  finish(101);
  assert.deepEqual(await Promise.all(pending), Array(20).fill(101));
});

test("all-in-flight saturation rejects new identities without bypassing the bound", async () => {
  const cache = createSnapshotCache<number>({ maxEntries: 1 });
  const identity = { userId: "owner", game: "endfield" as const, accountId: "account", serverId: "server", roleId: "role", version: 1 };
  let finish!: (value: number) => void;
  const pending = cache.read(identity, () => new Promise<number>(resolve => { finish = resolve; }));
  await assert.rejects(cache.read({ ...identity, userId: "other" }, async () => assert.fail("must not contact upstream")), /capacity/);
  const same = cache.read(identity, async () => assert.fail("must coalesce"));
  finish(1);
  assert.deepEqual(await Promise.all([pending, same]), [1, 1]);
  assert.equal(await cache.read({ ...identity, userId: "other" }, async () => 2), 2);
});

test("failed and revoked in-flight reads cannot poison or restore the cache", async () => {
  const cache = createSnapshotCache<number>();
  const identity = { userId: "one", game: "endfield" as const, accountId: "account", serverId: "server", roleId: "role", version: 1 };
  await assert.rejects(cache.read(identity, async () => { throw new Error("unavailable"); }));
  let finish!: (value: number) => void;
  const pending = cache.read(identity, () => new Promise(resolve => { finish = resolve; }));
  await Promise.resolve();
  cache.invalidateOwner(identity.userId);
  finish(1); await pending;
  assert.equal(await cache.read(identity, async () => 2), 2);
});
