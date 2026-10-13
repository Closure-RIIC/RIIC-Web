import assert from "node:assert/strict";
import test from "node:test";
import { RecentSklandOAuth } from "./recent-oauth.ts";

test("reusable authorization is isolated by website owner and exact Skland login", () => {
  const cache = new RecentSklandOAuth();
  cache.remember("owner-a", "cred-a", "test-token", 100);
  assert.equal(cache.get("owner-a", "cred-a", 101), "test-token");
  assert.equal(cache.get("owner-b", "cred-a", 101), null);
  assert.equal(cache.get("owner-a", "cred-b", 101), null);
  assert.equal(cache.get("owner-a", "cred-a", 100 + 60 * 60_000), null);
});

test("reusable authorization has a fixed capacity and replaces the same login", () => {
  const cache = new RecentSklandOAuth();
  for (let index = 0; index <= 512; index++) cache.remember("owner", `cred-${index}`, `token-${index}`, 100);
  assert.equal(cache.get("owner", "cred-0", 101), null);
  assert.equal(cache.get("owner", "cred-512", 101), "token-512");
  cache.remember("owner", "cred-512", "replacement", 102);
  assert.equal(cache.get("owner", "cred-512", 103), "replacement");
});
