import assert from "node:assert/strict";
import test from "node:test";

import { DeviceIdCache } from "./device-id-cache.ts";

class MemoryStorage {
  readonly values = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

test("reuses a generated device ID for later challenge clients", async () => {
  const cache = new DeviceIdCache();
  const first = new MemoryStorage();
  const second = new MemoryStorage();

  const firstResult = await cache.run(first, "did", async () => {
    await first.setItem("did", "device-1");
    return "first";
  });
  const secondResult = await cache.run(second, "did", async () => {
    assert.equal(await second.getItem("did"), "device-1");
    return "second";
  });

  assert.equal(firstResult, "first");
  assert.equal(secondResult, "second");
});

test("waits for an in-flight device ID before creating another challenge", async () => {
  const cache = new DeviceIdCache();
  const first = new MemoryStorage();
  const second = new MemoryStorage();
  let releaseFirst: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let secondStarted = false;

  const firstRun = cache.run(first, "did", async () => {
    await gate;
    await first.setItem("did", "device-2");
    return "first";
  });
  const secondRun = cache.run(second, "did", async () => {
    secondStarted = true;
    assert.equal(await second.getItem("did"), "device-2");
    return "second";
  });

  await Promise.resolve();
  assert.equal(secondStarted, false);
  releaseFirst?.();
  assert.deepEqual(await Promise.all([firstRun, secondRun]), ["first", "second"]);
});

test("allows a later request to retry after device ID generation fails", async () => {
  const cache = new DeviceIdCache();

  await assert.rejects(() => cache.run(new MemoryStorage(), "did", async () => "missing"));

  const retryStorage = new MemoryStorage();
  const result = await cache.run(retryStorage, "did", async () => {
    await retryStorage.setItem("did", "device-3");
    return "retry";
  });
  assert.equal(result, "retry");
});
