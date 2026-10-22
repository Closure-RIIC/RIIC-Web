import assert from "node:assert/strict";
import test from "node:test";
import { isForbiddenNativeAdminPath } from "./native-route-policy.ts";

test("blocks every Better Auth native admin endpoint", () => {
  for (const path of [
    "/api/auth/admin/impersonate-user",
    "/api/auth/admin/set-role",
    "/api/auth/admin/remove-user",
    "/api/auth/admin/set-user-password",
    "/api/auth/admin/ban-user",
  ]) assert.equal(isForbiddenNativeAdminPath(`https://example.test${path}`), true, path);
});

test("keeps normal Better Auth endpoints available", () => {
  assert.equal(isForbiddenNativeAdminPath("https://example.test/api/auth/sign-in/email"), false);
  assert.equal(isForbiddenNativeAdminPath("https://example.test/api/auth/delete-user"), false);
});
