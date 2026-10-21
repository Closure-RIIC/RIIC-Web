import assert from "node:assert/strict";
import test from "node:test";
import { responseWithClearedSklandCookies, sklandCookieNames } from "./session-cookie-cleanup.ts";

test("selects only Skland cookies for website-account cleanup", () => {
  assert.deepEqual(sklandCookieNames("better-auth.session_token=keep; skland_accounts_v3=a; skland_account_v3_id=b; preference=keep"), ["skland_accounts_v3", "skland_account_v3_id"]);
});

test("preserves the auth response and expires owned cookies after a successful action", async () => {
  const request = new Request("https://example.test/api/auth/sign-out", { headers: { cookie: "skland_accounts_v3=a; unrelated=b" } });
  const response = responseWithClearedSklandCookies(Response.json({ success: true }), request);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.match(response.headers.get("set-cookie") ?? "", /skland_accounts_v3=; Path=\/; Max-Age=0; HttpOnly; SameSite=Lax; Secure/);
  assert.doesNotMatch(response.headers.get("set-cookie") ?? "", /unrelated/);
});
