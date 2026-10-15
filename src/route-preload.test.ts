import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { createIntentPreloader, permitsPreload } from "./route-preload.ts";

test("brief hover cancels; sustained intent loads once even after repeated focus", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const loaded: string[] = [];
  const preloader = createIntentPreloader(async key => { loaded.push(key); }, () => true);
  preloader.schedule("/manual");
  t.mock.timers.tick(179);
  preloader.cancel("/manual");
  t.mock.timers.tick(500);
  await setImmediate();
  assert.deepEqual(loaded, []);
  preloader.schedule("/manual");
  t.mock.timers.tick(180);
  await setImmediate();
  preloader.schedule("/manual");
  t.mock.timers.tick(180);
  await setImmediate();
  assert.deepEqual(loaded, ["/manual"]);
});

test("one download at a time; a newer intent replaces the queued destination", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const loaded: string[] = [];
  let finish!: () => void;
  const preloader = createIntentPreloader(async key => {
    loaded.push(key);
    if (key === "/manual") await new Promise<void>(resolve => { finish = resolve; });
  }, () => true);
  preloader.schedule("/manual"); t.mock.timers.tick(180); await setImmediate();
  preloader.schedule("/training"); t.mock.timers.tick(180);
  preloader.schedule("/skills"); t.mock.timers.tick(180); await setImmediate();
  assert.deepEqual(loaded, ["/manual"]);
  finish(); await setImmediate();
  assert.deepEqual(loaded, ["/manual", "/skills"]);
});

test("navigation cancels queued work and connection policy is rechecked before loading", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let allowed = true;
  const loaded: string[] = [];
  const preloader = createIntentPreloader(async key => { loaded.push(key); }, () => allowed);
  preloader.schedule("/manual"); preloader.cancel(); t.mock.timers.tick(180);
  preloader.schedule("/training"); allowed = false; t.mock.timers.tick(180);
  await setImmediate();
  assert.deepEqual(loaded, []);
});

test("failed speculative imports can retry without rejecting into navigation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const preloader = createIntentPreloader(async () => { if (++calls === 1) throw new Error("offline"); }, () => true);
  preloader.schedule("/manual"); t.mock.timers.tick(180); await setImmediate();
  preloader.schedule("/manual"); t.mock.timers.tick(180); await setImmediate();
  assert.equal(calls, 2);
});

test("save-data and slow connections avoid speculative traffic", () => {
  assert.equal(permitsPreload(), true);
  assert.equal(permitsPreload({ effectiveType: "4g" }), true);
  for (const effectiveType of ["slow-2g", "2g", "3g"]) assert.equal(permitsPreload({ effectiveType }), false);
  assert.equal(permitsPreload({ saveData: true, effectiveType: "4g" }), false);
});
