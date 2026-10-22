import assert from "node:assert/strict";
import test from "node:test";
import { setResponseCookie } from "./response-cookies.ts";

test("response cookies preserve security attributes and append without replacing existing cookies", () => {
  const response = new Response(null, { headers: { "Set-Cookie": "existing=1; Path=/" } });
  setResponseCookie(response, "session", "value with spaces", {
    path: "/", domain: ".example.test", httpOnly: true, secure: true, sameSite: "lax", maxAge: 3600,
  });
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies[0], "existing=1; Path=/");
  assert.equal(cookies.length, 2);
  for (const part of ["session=value%20with%20spaces", "Path=/", "Domain=.example.test", "HttpOnly", "Secure", "SameSite=Lax", "Max-Age=3600"]) {
    assert.ok(cookies[1].split("; ").includes(part), part);
  }
});

test("response cookies support removal, default options, and a custom encoder", () => {
  const response = new Response(null);
  setResponseCookie(response, "removed", "", { maxAge: 0, expires: new Date(0) });
  setResponseCookie(response, "plain", "value");
  setResponseCookie(response, "custom", "a:b", { encode: value => value });
  const cookies = response.headers.getSetCookie();
  assert.match(cookies[0], /Max-Age=0/);
  assert.match(cookies[0], /Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
  assert.equal(cookies[1], "plain=value");
  assert.equal(cookies[2], "custom=a:b");
});
