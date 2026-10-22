import assert from "node:assert/strict";
import test from "node:test";
import { toAdminSessionData, toAdminUserData } from "./admin-dto.ts";

test("admin user DTO exposes role decisions without returning the raw database role", () => {
  const data = toAdminUserData({
    id: "delegated",
    name: "Delegated admin",
    email: "admin@example.test",
    emailVerified: true,
    role: "admin",
    banned: false,
    banReason: null,
    createdAt: new Date("2026-08-17T00:00:00.000Z"),
    sklandBindingCount: 2,
    sklandActiveBindingCount: 1,
    sklandRenewalDueCount: 1,
    paidPoints: 110,
    monthlyPoints: 300,
    monthlyExpiresAt: new Date("2099-08-24T00:00:00.000Z"),
  }, new Set());

  assert.deepEqual(data, {
    id: "delegated",
    name: "Delegated admin",
    email: "admin@example.test",
    emailVerified: true,
    banned: false,
    banReason: null,
    createdAt: "2026-08-17T00:00:00.000Z",
    isAdmin: true,
    isReviewer: false,
    isBootstrapAdmin: false,
    sklandBindingCount: 2,
    sklandActiveBindingCount: 1,
    sklandRenewalDueCount: 1,
    paidPoints: 110,
    monthlyPoints: 300,
    monthlyExpiresAt: "2099-08-24T00:00:00.000Z",
    totalPoints: 410,
  });
  assert.equal("role" in data, false);
});

test("admin session DTO serializes dates and keeps only the session display whitelist", () => {
  const data = toAdminSessionData({
    id: "session-1",
    createdAt: new Date("2026-08-17T00:00:00.000Z"),
    updatedAt: new Date("2026-08-17T00:01:00.000Z"),
    expiresAt: new Date("2026-08-24T00:00:00.000Z"),
    ipAddress: "192.0.2.1",
    userAgent: "Test browser",
  });

  assert.deepEqual(data, {
    id: "session-1",
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:01:00.000Z",
    expiresAt: "2026-08-24T00:00:00.000Z",
    ipAddress: "192.0.2.1",
    userAgent: "Test browser",
  });
});
