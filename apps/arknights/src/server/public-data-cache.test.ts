import assert from "node:assert/strict";
import test from "node:test";
import { cachePublicResponse, createPublicDataCache } from "./public-data-cache.ts";

test("public DTO cache coalesces loads, separates environments and expires after 15 seconds", async () => {
  let now = 0;
  let loads = 0;
  const cache = createPublicDataCache<string, number>(15_000, () => now);
  const load = async () => ++loads;
  assert.deepEqual(await Promise.all([cache.get("develop", load), cache.get("develop", load)]), [1, 1]);
  assert.equal(await cache.get("main", load), 2);
  now = 14_999;
  assert.equal(await cache.get("develop", load), 1);
  now = 15_000;
  assert.equal(await cache.get("develop", load), 3);
  assert.equal(cachePublicResponse(new Response()).headers.get("Cache-Control"), "public, max-age=15, must-revalidate");
});

test("invalidated in-flight generations cannot refill the cache or remove a new value", async () => {
  const cache = createPublicDataCache<string, string>();
  let resolve!: (value: string) => void;
  const old = cache.get("main", () => new Promise<string>((done) => { resolve = done; }));
  await Promise.resolve();
  cache.invalidate("main");
  assert.equal(await cache.get("main", async () => "fresh"), "fresh");
  resolve("old");
  assert.equal(await old, "old");
  assert.equal(await cache.get("main", async () => "unexpected"), "fresh");

  cache.invalidate("main");
  let reject!: (error: Error) => void;
  const failed = cache.get("main", () => new Promise<string>((_, fail) => { reject = fail; }));
  const rejection = assert.rejects(failed, /failed/);
  await Promise.resolve();
  cache.invalidate("main");
  await cache.get("main", async () => "newest");
  reject(new Error("failed"));
  await rejection;
  assert.equal(await cache.get("main", async () => "unexpected"), "newest");
});

test("errors are not cached and slow requests stay single-flight without extending freshness", async () => {
  let now = 0;
  const cache = createPublicDataCache<string, string>(15_000, () => now);
  await assert.rejects(cache.get("main", async () => { throw new Error("offline"); }), /offline/);
  let resolve!: (value: string) => void;
  const pending = cache.get("main", () => new Promise<string>((done) => { resolve = done; }));
  await Promise.resolve();
  now = 16_000;
  assert.equal(cache.get("main", async () => "duplicate"), pending);
  resolve("slow");
  await pending;
  assert.equal(await cache.get("main", async () => "fresh"), "fresh");
});
