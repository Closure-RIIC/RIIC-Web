import assert from "node:assert/strict";
import test from "node:test";

import { WEBSITE_SESSION_DURATION_SECONDS, extendedSessionCookie, extendedSessionExpiry } from "./session-lifetime.ts";

test("session extension lasts thirty days", () => {
  const now = new Date("2026-10-13T00:00:00.000Z");
  assert.equal(WEBSITE_SESSION_DURATION_SECONDS, 30 * 24 * 60 * 60);
  assert.equal(extendedSessionExpiry(now).toISOString(), "2026-11-12T00:00:00.000Z");
});

test("session extension preserves the signed session token and refreshes its cookie lifetime", () => {
  const request = new Request("https://example.test/api/account/session/extend", {
    headers: { cookie: "__Secure-better-auth.session_token=signed-token; preference=compact" },
  });
  assert.equal(
    extendedSessionCookie(request),
    `__Secure-better-auth.session_token=signed-token; Path=/; Max-Age=${WEBSITE_SESSION_DURATION_SECONDS}; HttpOnly; SameSite=Lax; Secure`,
  );
});
