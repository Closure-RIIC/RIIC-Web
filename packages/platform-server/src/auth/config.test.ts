import assert from "node:assert/strict";
import test from "node:test";
import { canChangeWebsiteAdminRole, canModerateWebsiteUser, isEligibleForWebsiteAdmin, websiteAdminAccess } from "./admin-access.ts";
import { configuredAdminIds, localAuthTrustedOrigins, requireAuthBaseUrl, requireAuthSecret } from "./config.ts";

test("Better Auth secret must contain at least 32 UTF-8 bytes", () => {
  assert.throws(() => requireAuthSecret("short"), /32 bytes/);
  assert.equal(requireAuthSecret("x".repeat(32)), "x".repeat(32));
  assert.equal(requireAuthSecret("密".repeat(11)), "密".repeat(11));
});

test("Better Auth base URL must be an HTTPS origin outside local development", () => {
  assert.equal(requireAuthBaseUrl("https://auth.example.test", "production"), "https://auth.example.test");
  assert.equal(requireAuthBaseUrl("http://127.0.0.1:5174", "development"), "http://127.0.0.1:5174");
  assert.throws(() => requireAuthBaseUrl("http://127.0.0.1:5174", "production"), /HTTPS/);
  assert.throws(() => requireAuthBaseUrl("http://auth.example.test", "development"), /HTTPS/);
  assert.throws(() => requireAuthBaseUrl("https://auth.example.test/path", "production"), /origin/);
});

test("administrator ids are explicit, trimmed Better Auth user ids", () => {
  assert.deepEqual([...configuredAdminIds(" user-one, user-two, user-one, ,")], ["user-one", "user-two"]);
  assert.equal(configuredAdminIds("").size, 0);
});

test("local development trusts only loopback aliases on the configured protocol and port", () => {
  for (const hostname of ["localhost", "127.0.0.1"]) {
    assert.deepEqual(localAuthTrustedOrigins(`http://${hostname}:5174`, "development", "local"), [
      "http://localhost:5174", "http://127.0.0.1:5174",
    ]);
  }
  assert.deepEqual(localAuthTrustedOrigins("https://localhost:5175", "development", "local"), [
    "https://localhost:5175", "https://127.0.0.1:5175",
  ]);
  assert.deepEqual(localAuthTrustedOrigins("http://localhost:5174", "production", "local"), []);
  assert.deepEqual(localAuthTrustedOrigins("http://localhost:5174", "development", "production"), []);
  assert.deepEqual(localAuthTrustedOrigins("https://riic.autos", "development", "local"), []);
  assert.deepEqual(localAuthTrustedOrigins("https://localhost.evil.test:5174", "development", "local"), []);
});

test("all administrators can assign roles while bootstrap administrators remain protected", () => {
  const bootstrapIds = new Set(["bootstrap"]);
  const bootstrap = websiteAdminAccess("bootstrap", "user", bootstrapIds);
  const delegated = websiteAdminAccess("delegated", "admin", bootstrapIds);
  const regular = websiteAdminAccess("regular", "user", bootstrapIds);

  assert.deepEqual(bootstrap, {
    userId: "bootstrap",
    isAdmin: true,
    isReviewer: false,
    canAccessReview: true,
    isBootstrapAdmin: true,
    canManageAdminRoles: true,
  });
  assert.equal(delegated.isAdmin, true);
  assert.equal(delegated.canManageAdminRoles, true);
  assert.equal(regular.isAdmin, false);
  assert.equal(canChangeWebsiteAdminRole(bootstrap, delegated), true);
  assert.equal(canChangeWebsiteAdminRole(delegated, regular), true);
  assert.equal(canChangeWebsiteAdminRole(delegated, websiteAdminAccess("peer", "admin", bootstrapIds)), true);
  assert.equal(canChangeWebsiteAdminRole(delegated, bootstrap), false);
  assert.equal(regular.canManageAdminRoles, false);
  assert.equal(canChangeWebsiteAdminRole(regular, delegated), false);
  assert.equal(canChangeWebsiteAdminRole(bootstrap, bootstrap), false);
  assert.equal(canModerateWebsiteUser(delegated, bootstrap), false);
  assert.equal(canModerateWebsiteUser(bootstrap, bootstrap), true);
  assert.equal(canModerateWebsiteUser(delegated, regular), true);
});

test("only the exact database admin role grants delegated access", () => {
  const bootstrapIds = new Set<string>();
  assert.equal(websiteAdminAccess("user", "admin", bootstrapIds).isAdmin, true);
  assert.equal(websiteAdminAccess("user", "ADMIN", bootstrapIds).isAdmin, false);
  assert.equal(websiteAdminAccess("user", null, bootstrapIds).isAdmin, false);
});

test("only verified and unbanned accounts are eligible for delegated administration", () => {
  assert.equal(isEligibleForWebsiteAdmin(true, false), true);
  assert.equal(isEligibleForWebsiteAdmin(true, null), true);
  assert.equal(isEligibleForWebsiteAdmin(false, false), false);
  assert.equal(isEligibleForWebsiteAdmin(true, true), false);
});

test("reviewers can review without administrator or role-management privileges", () => {
  const bootstrapIds = new Set(["bootstrap"]);
  const reviewer = websiteAdminAccess("reviewer", "reviewer", bootstrapIds);
  const regular = websiteAdminAccess("user", "user", bootstrapIds);
  assert.equal(reviewer.canAccessReview, true);
  assert.equal(reviewer.isReviewer, true);
  assert.equal(reviewer.isAdmin, false);
  assert.equal(reviewer.canManageAdminRoles, false);
  assert.equal(canChangeWebsiteAdminRole(reviewer, regular), false);
  assert.equal(canModerateWebsiteUser(reviewer, regular), false);
  assert.equal(canChangeWebsiteAdminRole(websiteAdminAccess("bootstrap", "user", bootstrapIds), reviewer), true);
  for (const role of ["user", "REVIEWER", "admin,reviewer", "", null, undefined]) {
    assert.equal(websiteAdminAccess("user", role, bootstrapIds).canAccessReview, false);
  }
  assert.equal(websiteAdminAccess("bootstrap", "reviewer", bootstrapIds).isReviewer, false);
  assert.equal(websiteAdminAccess("reviewer", "user", bootstrapIds).canAccessReview, false);
});
