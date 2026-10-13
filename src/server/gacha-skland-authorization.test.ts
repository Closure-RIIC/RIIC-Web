import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import test from "node:test";
import { PRIVACY_VERSION, TERMS_VERSION } from "../legal-policy.ts";
import { createSklandStoredAccount, sealOwnedSklandAccount, unsealOwnedSklandAccount, websiteUserOwnerTag } from "./skland/session.ts";

register("../../scripts/ts-path-loader.mjs", import.meta.url);
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : nextResolve(specifier, context);
} });
process.once("exit", () => hook.deregister());

test("restored Skland authorization works after one hour without a memory cache and handles missing or expired grants", async (context) => {
  let expired = false;
  let networkError = false;
  let grants = 0;
  await context.mock.module(new URL("./api-contract.ts", import.meta.url), { namedExports: {
    PublicApiError: class extends Error {
      constructor(code: string, options?: { message?: string }) { super(options?.message ?? code); }
    },
  } });
  await context.mock.module("skland-kit", { namedExports: {
    STORAGE_DID_KEY: "did",
    createClient: () => ({
      storage: { setItem: async (key: string, value: string) => { assert.equal(key, "did"); assert.equal(value, "test-device"); } },
      collections: { hypergryph: { grantAuthorizeCode: async (token: string) => {
        grants++;
        assert.equal(token, "private-account-oauth");
        if (expired) throw new Error("grant rejected", { cause: { status: 401 } });
        if (networkError) throw new Error("network unavailable");
        return { token: "private-binding-token" };
      } } },
    }),
  } });
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/binding_list?")) return Response.json({ data: { list: [{ appCode: "arknights", bindingList: [{ uid: "10001", nickname: "test" }] }] } });
    if (url.endsWith("/u8_token_by_uid")) return Response.json({ data: { token: "private-role-token" } });
    assert.ok(url.endsWith("/user/api/role/login"));
    return new Response("{}", { headers: { "set-cookie": "ak-user-center=private-role-cookie; HttpOnly" } });
  });
  const { authorizeGachaFromSkland } = await import("./gacha-history.ts");
  const now = Date.now();
  const secret = "test-only-secret-with-at-least-thirty-two-bytes";
  const owner = websiteUserOwnerTag("test-owner", secret);
  const account = createSklandStoredAccount({
    version: 3, cred: "test-cred", token: "skland-sign-token", accountOAuthToken: "private-account-oauth",
    dId: "test-device", userId: "skland-user", selectedUid: "10001", refreshedAt: now - 2 * 60 * 60_000,
    expiresAt: now + 60_000, policyConsent: { termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, acceptedAt: now - 2 * 60 * 60_000 },
  }, [{ uid: "10001", nickname: "test", channelName: "official", isDefault: true }], "account_one");
  const restored = unsealOwnedSklandAccount(sealOwnedSklandAccount(account, owner, secret), owner, secret, now);
  assert.ok(restored);
  const result = await authorizeGachaFromSkland("test-owner", restored.session);
  assert.deepEqual(result.roles, [{ uid: "10001", nickname: "test" }]);
  assert.equal(result.selectedUid, "10001");
  assert.equal(JSON.stringify(result).includes("private-"), false);
  await assert.rejects(authorizeGachaFromSkland("test-owner", { ...restored.session, accountOAuthToken: undefined }), /未保存寻访所需的授权/);
  assert.equal(grants, 1);
  expired = true;
  await assert.rejects(authorizeGachaFromSkland("test-owner", restored.session), /寻访授权已失效/);
  expired = false;
  networkError = true;
  await assert.rejects(authorizeGachaFromSkland("test-owner", restored.session), /network unavailable/);
});
