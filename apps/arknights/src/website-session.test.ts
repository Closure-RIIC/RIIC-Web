import assert from "node:assert/strict";
import test from "node:test";

import { parseWebsiteSession, requestWebsiteSession } from "./website-session-data.ts";

test("website session keeps only fields required by the shared client state", () => {
  assert.deepEqual(parseWebsiteSession({
    session: { id: "session-id", token: "secret-token" },
    user: { id: "user-id", name: "测试用户", email: "test@example.com" },
  }), null);

  assert.deepEqual(parseWebsiteSession({
    session: { id: "session-id", token: "secret-token", expiresAt: "2026-08-24T00:00:00.000Z" },
    user: { id: "user-id", name: "测试用户", email: "test@example.com", image: "private-avatar" },
  }), {
    session: { expiresAt: "2026-08-24T00:00:00.000Z" },
    user: { id: "user-id", name: "测试用户", email: "test@example.com" },
  });
});

test("website session silently treats failed or incomplete responses as anonymous", () => {
  assert.equal(parseWebsiteSession(null), null);
  assert.equal(parseWebsiteSession({ user: null }), null);
  assert.equal(parseWebsiteSession({ session: {}, user: { id: "" } }), null);
  assert.equal(parseWebsiteSession({ session: { expiresAt: null }, user: { id: 123 } }), null);
});

test("website session uses one credentialed no-store request and parses its public fields", async () => {
  let calls = 0;
  const session = await requestWebsiteSession(async (input, init) => {
    calls += 1;
    assert.equal(input, "/api/auth/get-session");
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.cache, "no-store");
    return new Response(JSON.stringify({
      session: { expiresAt: "2026-08-31T00:00:00.000Z", token: "must-not-survive" },
      user: { id: "user-id", name: "测试用户", email: "test@example.com" },
    }));
  });

  assert.equal(calls, 1);
  assert.deepEqual(session, {
    session: { expiresAt: "2026-08-31T00:00:00.000Z" },
    user: { id: "user-id", name: "测试用户", email: "test@example.com" },
  });
});

test("website session request degrades transport and HTTP failures to anonymous", async () => {
  assert.equal(await requestWebsiteSession(async () => new Response(null, { status: 401 })), null);
  assert.equal(await requestWebsiteSession(async () => {
    throw new Error("offline");
  }), null);
});
