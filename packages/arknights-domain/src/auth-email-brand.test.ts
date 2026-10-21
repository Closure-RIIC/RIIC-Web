import assert from "node:assert/strict";
import test from "node:test";

import { AUTH_EMAIL_BRAND, brandedAuthEmailFrom } from "./auth-email-brand.ts";

test("authentication email branding replaces any configured display name", () => {
  assert.equal(AUTH_EMAIL_BRAND, "可露希尔基建终端");
  assert.equal(brandedAuthEmailFrom("旧名称 <noreply@yeyouchuan.me>"), "可露希尔基建终端 <noreply@yeyouchuan.me>");
  assert.equal(brandedAuthEmailFrom("noreply@yeyouchuan.me"), "可露希尔基建终端 <noreply@yeyouchuan.me>");
});
