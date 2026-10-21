import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveSklandBindingState,
  SKLAND_BINDING_TTL_MS,
  summarizeSklandBindings,
} from "./skland-binding-state.ts";

test("binding summaries split active and renewal-due records at the exact seven-day boundary", () => {
  const now = Date.UTC(2026, 7, 18, 12);
  const summary = summarizeSklandBindings([
    now - SKLAND_BINDING_TTL_MS + 1,
    now - SKLAND_BINDING_TTL_MS,
    now - SKLAND_BINDING_TTL_MS - 1_000,
  ], now);

  assert.deepEqual(summary, {
    totalCount: 3,
    activeCount: 1,
    renewalDueCount: 2,
    nextExpiresAt: now + 1,
    latestExpiredAt: now,
  });
});

test("a persisted website binding is distinguished from a current browser credential", () => {
  const active = summarizeSklandBindings([Date.now()]);
  const expired = summarizeSklandBindings([Date.now() - SKLAND_BINDING_TTL_MS]);
  assert.equal(deriveSklandBindingState(active, 0), "reauthorize");
  assert.equal(deriveSklandBindingState(active, 1), "active");
  assert.equal(deriveSklandBindingState(expired, 0), "renewal-due");
  assert.equal(deriveSklandBindingState(summarizeSklandBindings([]), 0), "unbound");
});
