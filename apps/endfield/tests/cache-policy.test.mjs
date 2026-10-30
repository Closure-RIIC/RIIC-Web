import assert from "node:assert/strict";
import test from "node:test";
import { applyEndfieldCachePolicy } from "../src/server/cache-policy.ts";

function policy(path, { mode = "public", status = 200, headers = {}, method = "GET" } = {}) {
  const response = new Response(null, { status, headers });
  applyEndfieldCachePolicy(new Request("https://dj.riic.test" + path, { method }), response, mode);
  return response.headers;
}
test("versioned static files cache publicly; pages and private APIs never do", () => {
  assert.equal(policy("/assets/app-1234abcd.js").get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(policy("/assets/font-1234abcd.woff2", { method: "HEAD", status: 304 }).get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(policy("/images/game/operator.png").get("cache-control"), "public, max-age=3600");
  for (const path of ["/", "/manual", "/api/auth/get-session", "/api/skland/accounts", "/assets/nonversioned.js", "/assets/app-1234abcd.js.map", "/images/api.json"]) {
    assert.equal(policy(path).get("cache-control"), "private, no-store");
    assert.equal(policy(path).get("vary"), "Cookie");
  }
});
test("preview access, errors and responses carrying sessions are never public", () => {
  for (const options of [{ mode: "admin" }, { mode: "invalid" }, { status: 404 }, { status: 403 }, { method: "POST" }, { headers: { "set-cookie": "session=test" } }]) {
    assert.equal(policy("/assets/app-1234abcd.js", options).get("cache-control"), "private, no-store");
  }
  assert.equal(policy("/assets/app-1234abcd.js", { headers: { vary: "Cookie, Accept-Encoding" } }).get("vary"), "Accept-Encoding");
});
