import assert from "node:assert/strict";
import test from "node:test";
import { isBillingOrderVisible, PENDING_ORDER_VISIBLE_MS } from "./billing-order-visibility.ts";

test("pending orders expire at exactly 72 hours; paid orders remain visible", () => {
  const created = Date.parse("2026-10-13T00:00:00Z");
  const pending = { status: "pending", createdAt: new Date(created).toISOString() };
  assert.equal(isBillingOrderVisible(pending, created + PENDING_ORDER_VISIBLE_MS - 1), true);
  assert.equal(isBillingOrderVisible(pending, created + PENDING_ORDER_VISIBLE_MS), false);
  assert.equal(isBillingOrderVisible({ ...pending, hiddenAt: pending.createdAt }, created), false);
  assert.equal(isBillingOrderVisible({ ...pending, status: "paid", hiddenAt: pending.createdAt }, created + PENDING_ORDER_VISIBLE_MS * 2), true);
  assert.equal(isBillingOrderVisible({ ...pending, status: "refunded" }, created + PENDING_ORDER_VISIBLE_MS * 2), true);
});
