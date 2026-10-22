import assert from "node:assert/strict";
import test from "node:test";
import { loadSessionBootstrap } from "./account-session.ts";

test("bootstrap isolates simultaneous request identities and whitelists serialized fields", async () => {
  const read = (id: string) => async () => ({
    user: { id, name: id, email: `${id}@example.invalid`, role: "admin" },
    session: { id: "private-session", token: "private-token", expiresAt: "2099-01-01" },
  });
  const [first, second] = await Promise.all([loadSessionBootstrap(read("a")), loadSessionBootstrap(read("b"))]);
  assert.deepEqual(first, { user: { id: "a", name: "a", email: "a@example.invalid" }, session: { expiresAt: "2099-01-01" } });
  assert.equal(second?.user.id, "b");
  assert.equal(await loadSessionBootstrap(async () => null), null, "A signed-out request cannot reuse a previous identity");
});

test("bootstrap distinguishes anonymous, malformed and failed lookups for retry", async () => {
  assert.equal(await loadSessionBootstrap(async () => null), null);
  assert.equal(await loadSessionBootstrap(async () => ({ user: { id: "broken" } })), null);
  assert.equal(await loadSessionBootstrap(async () => { throw new Error("offline"); }), undefined);
});
