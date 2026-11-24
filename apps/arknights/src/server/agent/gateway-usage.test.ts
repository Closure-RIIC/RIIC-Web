import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGatewayUsageCounts, readRuntimeCacheWriteTokens } from "./gateway-usage.ts";

const sdkUsage = (write: unknown) => ({ inputTokens: { total: 110, cacheRead: 30, cacheWrite: write } });
const rawUsage = (write: unknown) => ({ raw: { prompt_tokens: 110, prompt_tokens_details: { cached_tokens: 30, cache_write_tokens: write } } });

test("runtime preserves missing, zero and measured writes from SDK or raw Chat usage", () => {
  assert.equal(readRuntimeCacheWriteTokens({ inputTokens: { total: 110, cacheRead: 30, cacheWrite: undefined } }), undefined);
  assert.equal(readRuntimeCacheWriteTokens({ inputTokens: { total: 110 }, raw: { prompt_tokens: 110, prompt_tokens_details: { cached_tokens: 30 } } }), undefined);
  assert.equal(readRuntimeCacheWriteTokens({ raw: { prompt_tokens_details: null } }), undefined);
  for (const write of [0, 20]) {
    assert.equal(readRuntimeCacheWriteTokens(sdkUsage(write)), write);
    assert.equal(readRuntimeCacheWriteTokens(rawUsage(write)), write);
    assert.equal(readRuntimeCacheWriteTokens({ ...sdkUsage(write), ...rawUsage(write) }), write);
  }
});

test("runtime rejects invalid or conflicting counters rather than inventing zero", () => {
  for (const write of [-1, 0.5, "20", null, false, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, { ttl_30m_tokens: 20, ttl_12h_tokens: 1 }]) {
    assert.throws(() => readRuntimeCacheWriteTokens(sdkUsage(write)), /Invalid/);
    assert.throws(() => readRuntimeCacheWriteTokens(rawUsage(write)), /Invalid/);
    assert.throws(() => readRuntimeCacheWriteTokens({ ...sdkUsage(0), ...rawUsage(write) }), /Invalid/);
  }
  for (const [sdk, raw] of [[0, 20], [20, 0], [20, 21]]) {
    assert.throws(() => readRuntimeCacheWriteTokens({ ...sdkUsage(sdk), ...rawUsage(raw) }), /Conflicting/);
  }
  for (const usage of [null, [], { inputTokens: 4 }, { raw: [] }, { raw: { prompt_tokens_details: "invalid" } }]) {
    assert.throws(() => readRuntimeCacheWriteTokens(usage), /Invalid/);
  }
});

test("runtime refuses unsupported TTLs and validates any supplied write breakdown", () => {
  const withTtl = (ttl: unknown, write: unknown = 20) => ({ raw: { prompt_tokens_details: { cache_write_tokens: write, cache_write_tokens_details: ttl } } });
  assert.equal(readRuntimeCacheWriteTokens(withTtl({ ttl_30m_tokens: 20, ttl_12h_tokens: 0 })), 20);
  assert.equal(readRuntimeCacheWriteTokens(withTtl({ ttl_30m_tokens: 0 }, 0)), 0);
  assert.throws(() => readRuntimeCacheWriteTokens(withTtl({ ttl_30m_tokens: 20, ttl_12h_tokens: 1 })), /Unsupported/);
  assert.throws(() => readRuntimeCacheWriteTokens(withTtl({ ttl_1h_tokens: 20 })), /Unsupported/);
  assert.throws(() => readRuntimeCacheWriteTokens(withTtl({ ttl_30m_tokens: 19 })), /Conflicting/);
  assert.throws(() => readRuntimeCacheWriteTokens({ raw: { prompt_tokens_details: { cache_write_tokens_details: { ttl_30m_tokens: 20 } } } }), /Conflicting/);
  for (const ttl of [null, [], "20", { ttl_12h_tokens: "0" }, { ttl_30m_tokens: -1 }]) {
    assert.throws(() => readRuntimeCacheWriteTokens(withTtl(ttl)), /Invalid/);
  }
});

test("gateway ledger reconstruction includes ordinary input, reads and writes exactly once", () => {
  assert.deepEqual(normalizeGatewayUsageCounts({ in: 8000, out: 400, cache_read: 113000, cache_write: 9000 }),
    { inputTokens: 130000, outputTokens: 400, cachedInputTokens: 113000, cacheWriteTokens: 9000 });
  assert.deepEqual(normalizeGatewayUsageCounts({ in: 110, out: 12 }),
    { inputTokens: 110, outputTokens: 12, cachedInputTokens: 0, cacheWriteTokens: 0 });
  assert.deepEqual(normalizeGatewayUsageCounts({ in: 0, out: 0, cache_read: 0, cache_write: 0 }),
    { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0 });
});

test("gateway invalid, missing, overflowing or unsupported counts remain unmeasured", () => {
  for (const row of [null, [], {}, { in: 1 }, { out: 1 }, { in: 2_147_483_647, out: 1, cache_write: 1 }, { in: 1, out: 2_147_483_648 },
    { in: 1, out: 1, cache_write: 20, cache_write_1h: 20 }]) {
    assert.equal(normalizeGatewayUsageCounts(row), undefined);
  }
  for (const field of ["in", "out", "cache_read", "cache_write", "cache_write_1h"]) {
    for (const count of [-1, 0.5, "20", null, false, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.equal(normalizeGatewayUsageCounts({ in: 110, out: 12, [field]: count }), undefined, `${field} must reject ${String(count)}`);
    }
  }
});
