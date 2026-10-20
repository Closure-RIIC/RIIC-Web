import assert from "node:assert/strict";
import test from "node:test";

import {
  nextShiftPortraitUrls,
  preloadWithConcurrency,
  scheduleIdleTask,
  shouldPreloadPortraits,
} from "./schedule-portrait-preload.ts";
import type { MaaJson } from "./types.ts";

test("empty facilities without an operators array do not break portrait preloading", () => {
  const maa = { title: "test", plans: [
    { rooms: { training: [{}] } },
    { rooms: { training: [{}], manufacture: [{ operators: ["空"] }] } },
  ] } as unknown as MaaJson;
  assert.deepEqual(nextShiftPortraitUrls(maa, 0, name => name === "空" ? "/sora.webp" : undefined), ["/sora.webp"]);
});

test("collects only next-shift portrait URLs that are absent from the active shift", () => {
  const portraitByName: Record<string, string> = {
    shared: "/shared.webp",
    "active-alias": "/alias.webp",
    "next-alias": "/alias.webp",
    "active-target": "/active-target.webp",
    "next-only": "/next-only.webp",
    "next-target": "/next-target.webp",
    "later-only": "/later-only.webp",
  };
  let receivedUnexpectedArguments = false;
  const urls = nextShiftPortraitUrls({ title: "test", plans: [
    { name: "1", rooms: { trading: [{ operators: ["shared", { name: "active-alias" }, null] }] }, Fiammetta: { enable: true, target: "active-target" } },
    { name: "2", rooms: { manufacture: [{ operators: ["shared", "next-alias", "next-only", "next-only"] }] }, Fiammetta: { enable: true, target: ["next-target", "shared"] } },
    { name: "3", rooms: { power: [{ operators: ["later-only"] }] } },
  ] }, 0, (name, ...rest: unknown[]) => {
    receivedUnexpectedArguments ||= rest.length > 0;
    return portraitByName[name];
  });
  assert.deepEqual(urls, ["/next-only.webp", "/next-target.webp"]);
  assert.equal(receivedUnexpectedArguments, false);
});

test("preloads with bounded concurrency and ignores individual failures", async () => {
  let active = 0;
  let peak = 0;
  const loaded: number[] = [];
  await preloadWithConcurrency([1, 2, 3, 4, 5], async (item) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    if (item === 3) throw new Error("failed");
    loaded.push(item);
  }, 2);
  assert.equal(peak, 2);
  assert.deepEqual(loaded.sort(), [1, 2, 4, 5]);
});

test("stops starting new portrait loads after cancellation", async () => {
  const controller = new AbortController();
  const started: number[] = [];
  await preloadWithConcurrency([1, 2, 3], async (item) => {
    started.push(item);
    controller.abort();
  }, 2, controller.signal);
  assert.deepEqual(started, [1]);
});

test("skips speculative portraits for data-saving and slow connections", () => {
  assert.equal(shouldPreloadPortraits(), true);
  assert.equal(shouldPreloadPortraits({ effectiveType: "4g" }), true);
  assert.equal(shouldPreloadPortraits({ saveData: true, effectiveType: "4g" }), false);
  assert.equal(shouldPreloadPortraits({ effectiveType: "3g" }), false);
  assert.equal(shouldPreloadPortraits({ effectiveType: "2g" }), false);
});

test("cancels queued idle work before it can start", () => {
  let queued: (() => void) | undefined;
  let cancelledHandle: number | undefined;
  let runs = 0;
  const cancel = scheduleIdleTask(() => { runs += 1; }, {
    requestIdleCallback: (callback) => {
      queued = callback;
      return 17;
    },
    cancelIdleCallback: (handle) => { cancelledHandle = handle; },
    setTimeout,
    clearTimeout,
  });

  cancel();
  queued?.();
  assert.equal(cancelledHandle, 17);
  assert.equal(runs, 0);
});
