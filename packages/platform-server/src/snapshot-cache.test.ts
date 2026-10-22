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
