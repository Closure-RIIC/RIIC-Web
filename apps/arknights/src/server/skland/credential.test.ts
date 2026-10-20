import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

import {
  createSklandRequestSignature,
  MAX_SKLAND_CREDENTIAL_BYTES,
  mowerSklandSignedHeaders,
  parseSklandCredential,
  SklandCredentialFormatError,
  sklandSignedHeaders,
  stableSklandUserIdFromResponse,
} from "./credential.ts";

test("credential parser accepts outer whitespace, newlines, and copied quotes", () => {
  assert.deepEqual(parseSklandCredential("  cred-value,token-value  "), {
    cred: "cred-value",
    token: "token-value",
  });
  assert.deepEqual(parseSklandCredential("\r\n\" cred-value, token-value \"\n"), {
    cred: "cred-value",
    token: "token-value",
  });
  assert.deepEqual(parseSklandCredential("'cred-value,token-value'"), {
    cred: "cred-value",
    token: "token-value",
  });
});

test("credential parser rejects missing fields, sentinels, extra commas, controls, and oversized input", () => {
  const invalid: unknown[] = [
    null,
    undefined,
    "",
    ",",
    "cred,",
    ",token",
    "cred,token,extra",
    "null,token",
    "cred,undefined",
    "\"cred,token'",
    "cred\nvalue,token",
    `cred,${"x".repeat(MAX_SKLAND_CREDENTIAL_BYTES)}`,
  ];
  for (const value of invalid) {
    assert.throws(() => parseSklandCredential(value), SklandCredentialFormatError);
  }
});

test("credential parser errors never include submitted secrets", () => {
  const secret = "private-cred\nprivate-token";
  assert.throws(
    () => parseSklandCredential(secret),
    (error: unknown) => {
      assert.ok(error instanceof SklandCredentialFormatError);
      assert.equal(error.message.includes("private-cred"), false);
      assert.equal(error.message.includes("private-token"), false);
      assert.equal(String(error.stack).includes("private-cred"), false);
      return true;
    },
  );
});

test("Skland signing matches the fixed request vector", () => {
  const signature = createSklandRequestSignature({
    token: "token-fixture",
    path: "/api/v1/user/teenager",
    timestamp: "1725000000",
    headers: {
      platform: "3",
      timestamp: "1725000000",
      dId: "Bfixture-device",
      vName: "1.0.0",
    },
  });
  assert.equal(signature, "5ccf5e94d016ab815b14b1ca9d7a9554");

  const headers = sklandSignedHeaders({
    cred: "cred-fixture",
    token: "token-fixture",
    dId: "Bfixture-device",
    path: "/api/v1/user/teenager",
    now: 1_725_000_002_000,
  });
  assert.equal(headers.timestamp, "1725000000");
  assert.equal(headers.sign, signature);
  assert.equal(headers.cred, "cred-fixture");
});

test("mower inventory signing keeps the legacy cultivate request shape", () => {
  const headers = mowerSklandSignedHeaders({
    cred: "cred-fixture",
    token: "token-fixture",
    path: "/api/v1/game/cultivate/player",
    query: "uid=role-fixture",
    now: 1_725_000_002_000,
  });
  assert.equal(headers.timestamp, "1725000000");
  assert.equal(headers.platform, "");
  assert.equal(headers.dId, "");
  assert.equal(headers.vName, "");
  assert.equal(headers.cred, "cred-fixture");
  assert.match(headers.sign, /^[a-f0-9]{32}$/);
});

test("stable Skland identity requires the documented successful response shape", () => {
  assert.equal(stableSklandUserIdFromResponse({
    code: 0,
    data: { teenager: { userId: " stable-user_123 " } },
  }), "stable-user_123");
  assert.equal(stableSklandUserIdFromResponse({ code: 10000, data: { teenager: { userId: "user" } } }), null);
  assert.equal(stableSklandUserIdFromResponse({ code: 0, data: { teenager: { userId: 123 } } }), null);
  assert.equal(stableSklandUserIdFromResponse({ code: 0, data: { teenager: { userId: "user\nother" } } }), null);
  assert.equal(stableSklandUserIdFromResponse({ code: 0, data: {} }), null);
});

test("credential route enforces admission before reading secrets and reuses shared completion", async () => {
  const route = await readFile(new URL("../../app/api/skland/auth/credential/route.ts", import.meta.url), "utf8");
  const qrRoute = await readFile(new URL("../../app/api/skland/auth/qr/status/route.ts", import.meta.url), "utf8");
  const completion = await readFile(new URL("./auth-completion.ts", import.meta.url), "utf8");

  assert.ok(route.indexOf("await requireWebsiteSession(request)") < route.indexOf("await readJsonBody(request"));
  assert.ok(route.indexOf("assertSklandAvailable(request)") < route.indexOf("await readJsonBody(request"));
  assert.ok(route.indexOf("assertSameOrigin(request)") < route.indexOf("await readJsonBody(request"));
  assert.match(route, /if \(!request\.headers\.get\("origin"\)\).*AIC-AUTH-2002/);
  assert.match(route, /readJsonBody\(request, 16 \* 1024\)/);
  assert.match(route, /skland-credential-account[\s\S]*10, 10 \* 60_000/);
  assert.match(route, /skland-credential-ip[\s\S]*20, 10 \* 60_000/);
  assert.match(route, /AIC-AUTH-2010/);
  assert.match(route, /finalizeSklandAuthentication/);
  assert.match(qrRoute, /finalizeSklandAuthentication/);
  assert.match(completion, /upsertSklandAccount/);
  assert.match(completion, /bindSklandAccount/);
  assert.doesNotMatch(completion, /setSklandAccountStoreCookies/);
  assert.match(route, /setSklandAccountStoreCookies/);
  assert.match(qrRoute, /setSklandAccountStoreCookies/);
});
