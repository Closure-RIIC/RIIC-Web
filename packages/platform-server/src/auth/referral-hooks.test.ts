import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register("../../../../scripts/ts-path-loader.mjs", import.meta.url);

const { createWebsiteReferralDatabaseHooks, websiteReferralUserFields } = await import("./referral-hooks.ts");
type Hooks = ReturnType<typeof createWebsiteReferralDatabaseHooks>;
type HookContext = NonNullable<Parameters<Hooks["user"]["create"]["before"]>[1]>;

const newUser = {
  id: "new-user", name: "  新用户  ", email: "referral@example.invalid", emailVerified: false,
  createdAt: new Date("2026-11-16T00:00:00Z"), updatedAt: new Date("2026-11-16T00:00:00Z"),
};
function context(path = "/sign-up/email", code = "invite-code"): HookContext {
  return { path, headers: new Headers({ "x-riic-referral-code": code }) } as HookContext;
}

test("real signup persists the validated referral with the new user before email verification", async () => {
  const captured: Array<[string, string]> = [];
  const hooks = createWebsiteReferralDatabaseHooks({
    prepare: async code => { assert.equal(code, "invite-code"); return "validated-code"; },
    capture: async (userId, code) => { captured.push([userId, code]); },
    captureFailed: () => assert.fail("capture unexpectedly failed"),
  });
  const { data } = await hooks.user.create.before(newUser, context("/sign-up/email", " invite-code "));
  assert.equal(data.name, "新用户");
  assert.equal(data.emailVerified, false);
  assert.equal(data.signupReferralCode, "validated-code");
  assert.deepEqual(captured, []);
  await hooks.user.create.after(data);
  assert.deepEqual(captured, [["new-user", "validated-code"]]);
  assert.deepEqual(websiteReferralUserFields.signupReferralCode, {
    type: "string", required: false, input: false, returned: false,
  });
});

test("other auth paths and untrusted marker input cannot establish referral attribution", async () => {
  let prepared = 0;
  let captured = 0;
  const hooks = createWebsiteReferralDatabaseHooks({
    prepare: async () => { prepared++; return "invite-code"; },
    capture: async () => { captured++; },
    captureFailed: () => assert.fail(),
  });
  for (const requestContext of [null, context("/sign-in/email"), context("/email-otp/verify-email"), context("/admin/create-user"), context("/sign-up/email", "")]) {
    const { data } = await hooks.user.create.before({ ...newUser, signupReferralCode: "forged" }, requestContext);
    assert.equal(data.signupReferralCode, null);
    await hooks.user.create.after(data);
  }
  assert.equal(prepared, 0);
  assert.equal(captured, 0);
});

test("closed or invalid invitations leave normal signup unchanged and lookup failures stop before create", async () => {
  const hooks = createWebsiteReferralDatabaseHooks({
    prepare: async () => null,
    capture: async () => assert.fail("invalid invitation must not be captured"),
    captureFailed: () => assert.fail(),
  });
  const { data } = await hooks.user.create.before(newUser, context());
  assert.equal(data.signupReferralCode, null);
  await hooks.user.create.after(data);
  const unavailable = createWebsiteReferralDatabaseHooks({
    prepare: async () => { throw new Error("database unavailable"); },
    capture: async () => assert.fail(),
    captureFailed: () => assert.fail(),
  });
  await assert.rejects(unavailable.user.create.before(newUser, context()), /database unavailable/);
});

test("email signup rejects an unavailable manual code before creating the account and accepts a corrected code", async () => {
  const { betterAuth } = await import("better-auth");
  const { memoryAdapter } = await import("better-auth/adapters/memory");
  const records: Record<string, Array<Record<string, unknown>>> = { user: [], account: [], session: [], verification: [] };
  const validCode = "ABCDEF0123456789ABCDEF01";
  const auth = betterAuth({
    baseURL: "https://referral.example.test", secret: "referral-unit-test-secret-for-signup-only",
    database: memoryAdapter(records), user: { additionalFields: websiteReferralUserFields },
    emailAndPassword: { enabled: true, autoSignIn: false },
    databaseHooks: createWebsiteReferralDatabaseHooks({
      prepare: async code => code === validCode ? code : null,
      capture: async () => {}, captureFailed: () => assert.fail(),
    }),
  });
  const signup = (code: string) => auth.api.signUpEmail({
    body: { name: "邀请测试", email: "manual@example.test", password: "TestPassword123!" },
    headers: new Headers({ "x-riic-referral-code": code, "x-riic-require-referral": "1" }), asResponse: true,
  });
  const rejected = await signup("0123456789ABCDEF01234567");
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).code, "REFERRAL_CODE_UNAVAILABLE");
  assert.equal(records.user.length, 0);
  assert.equal(records.account.length, 0);
  const accepted = await signup(validCode);
  assert.equal(accepted.status, 200);
  assert.equal(records.user[0].signupReferralCode, validCode);
});

test("after-hook failure preserves the durable marker and successful account creation for recovery", async () => {
  let failures = 0;
  const hooks = createWebsiteReferralDatabaseHooks({
    prepare: async () => "invite-code",
    capture: async () => { throw new Error("temporary failure"); },
    captureFailed: () => { failures++; },
  });
  const { data } = await hooks.user.create.before(newUser, context());
  await assert.doesNotReject(hooks.user.create.after(data));
  assert.equal(data.signupReferralCode, "invite-code");
  assert.equal(failures, 1);
});

test("referral composition preserves account-name validation on create and update", async () => {
  const hooks = createWebsiteReferralDatabaseHooks({
    prepare: async () => assert.fail("name validation must run first"),
    capture: async () => assert.fail(),
    captureFailed: () => assert.fail(),
  });
  await assert.rejects(hooks.user.create.before({ ...newUser, name: "!" }, context()));
  await assert.rejects(hooks.user.update.before({ name: "!" }));
  assert.deepEqual(await hooks.user.update.before({ name: "  正常昵称  " }), { data: { name: "正常昵称" } });
  assert.equal(await hooks.user.update.before({}), undefined);
});

test("Better Auth stores the server marker, exposes it to after hooks and omits it from public user output", async () => {
  const { betterAuth } = await import("better-auth");
  const { memoryAdapter } = await import("better-auth/adapters/memory");
  const { parseUserInput, parseUserOutput } = await import("better-auth/db");
  const { runWithEndpointContext } = await import("@better-auth/core/context");
  const records: Record<string, Array<Record<string, unknown>>> = { user: [], account: [], session: [], verification: [] };
  const captured: Array<[string, string]> = [];
  const hooks = createWebsiteReferralDatabaseHooks({
    prepare: async code => { assert.equal(code, "invite-code"); return "validated-code"; },
    capture: async (userId, code) => { captured.push([userId, code]); },
    captureFailed: () => assert.fail("real framework after hook failed"),
  });
  const auth = betterAuth({
    baseURL: "https://referral.example.invalid",
    secret: "referral-test-only-auth-secret-0123456789abcdef",
    database: memoryAdapter(records),
    databaseHooks: hooks,
    user: { additionalFields: websiteReferralUserFields },
  });
  const authContext = await auth.$context;
  const account = await runWithEndpointContext({ ...context(), context: authContext }, () =>
    authContext.internalAdapter.createUser({ name: "新用户", email: "framework@example.invalid", emailVerified: false }, { method: "email-password" }),
  );
  assert.equal(records.user[0]?.signupReferralCode, "validated-code");
  assert.equal(account.signupReferralCode, "validated-code");
  assert.deepEqual(captured, [[account.id, "validated-code"]]);
  assert.equal(account.emailVerified, false);
  assert.equal(Object.hasOwn(parseUserOutput(auth.options, account), "signupReferralCode"), false);
  assert.throws(() => parseUserInput(auth.options, { signupReferralCode: "forged" }, "create"), /not allowed/);
  assert.throws(() => parseUserInput(auth.options, { signupReferralCode: "forged" }, "update"), /not allowed/);
  assert.deepEqual(records.account, []);
});
