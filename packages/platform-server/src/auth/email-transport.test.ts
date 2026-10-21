import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import test, { type TestContext } from "node:test";
import { AUTH_EMAIL_BRAND } from "@riic/arknights-domain/auth-email-brand";
import { ALIYUN_DM_ENDPOINTS, requireAuthEmailConfig } from "./email-config.ts";
import { signAliyunParameters } from "./aliyun-email.ts";
import { deliverAuthEmail } from "./email-transport.ts";

register("../../../../scripts/ts-path-loader.mjs", import.meta.url);
const serverOnlyHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@tanstack/react-start/server-only") return { shortCircuit: true, url: "data:text/javascript,export{}" };
    return nextResolve(specifier, context);
  },
});
process.once("exit", () => serverOnlyHook.deregister());

const primaryEnv = { RESEND_API_KEY: "test-resend-key", AUTH_EMAIL_FROM: "auth@example.test" };
const env = {
  ...primaryEnv, AUTH_EMAIL_PROVIDER: "resend", AUTH_EMAIL_FALLBACK_PROVIDER: "aliyun",
  ALIYUN_DM_REGION_ID: "cn-hangzhou", ALIYUN_DM_ACCOUNT_NAME: "auth@backup.example.test",
  ALIYUN_DM_ACCESS_KEY_ID: "testid", ALIYUN_DM_ACCESS_KEY_SECRET: "testsecret",
};
const message = {
  from: `${AUTH_EMAIL_BRAND} <auth@example.test>`, to: "recipient@example.test",
  subject: "邮箱验证码", text: "验证码 123456", html: "<p>验证码 <b>123456</b></p>",
};
function accepted() { return Response.json({ EnvId: "aliyun-message", RequestId: "request-id" }); }
function rejected(name: string, status = 429) {
  return Response.json({ name, statusCode: status, message: "private provider details" }, { status });
}
function mockRequests(context: TestContext, responses: Array<Response | Error>) {
  const calls: Array<{ url: string; options: RequestInit }> = [];
  context.mock.method(console, "error", () => {}); // SDK development logging.
  context.mock.method(console, "warn", () => {});
  context.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    calls.push({ url: String(url), options });
    const next = responses.shift();
    assert.ok(next, "Unexpected additional send attempt");
    if (next instanceof Error) throw next;
    return next;
  });
  return calls;
}
function body(call: { options: RequestInit }) { return new URLSearchParams(String(call.options.body)); }

test("Direct Mail signing matches Alibaba's published POST test vector", () => {
  // https://help.aliyun.com/en/direct-mail/signature
  const parameters = Object.fromEntries(new URLSearchParams(
    "AccessKeyId=testid&AccountName=%3Ca%25b%27%3E&Action=SingleSendMail&AddressType=1&Format=XML&HtmlBody=4&RegionId=cn-hangzhou&ReplyToAddress=true&SignatureMethod=HMAC-SHA1&SignatureNonce=c1b2c332-4cfb-4a0f-b8cc-ebe622aa0a5c&SignatureVersion=1.0&Subject=3&TagName=2&Timestamp=2016-10-20T06%3A27%3A56Z&ToAddress=1%40test.com&Version=2015-11-23"));
  assert.equal(signAliyunParameters(parameters, "testsecret"), "llJfXJjBW3OacrVgxxsITgYaYm0=");
  assert.equal(signAliyunParameters({ ...parameters, Signature: "ignored" }, "testsecret"), "llJfXJjBW3OacrVgxxsITgYaYm0=");
});

test("existing Resend configuration works and unused Aliyun credentials do not enable fallback", () => {
  assert.equal(requireAuthEmailConfig(primaryEnv).aliyun, undefined);
  assert.equal(requireAuthEmailConfig({ ...env, AUTH_EMAIL_FALLBACK_PROVIDER: "none" }).aliyun, undefined);
  assert.throws(() => requireAuthEmailConfig({ AUTH_EMAIL_FROM: "auth@example.test" }), /RESEND_API_KEY/);
});

test("enabled Aliyun configuration rejects incomplete credentials, unknown regions and multiple senders", () => {
  for (const overrides of [
    { ALIYUN_DM_REGION_ID: "" }, { ALIYUN_DM_REGION_ID: "https://evil.example.test" },
    { ALIYUN_DM_REGION_ID: "toString" }, { ALIYUN_DM_REGION_ID: "ap-southeast-2" },
    { ALIYUN_DM_ACCOUNT_NAME: "" }, { ALIYUN_DM_ACCOUNT_NAME: "Name <auth@example.test>" },
    { ALIYUN_DM_ACCOUNT_NAME: "a@example.test,b@example.test" },
    { ALIYUN_DM_ACCESS_KEY_ID: "" }, { ALIYUN_DM_ACCESS_KEY_SECRET: "" },
    { ALIYUN_DM_ACCESS_KEY_SECRET: "secret\ninjected" },
    { AUTH_EMAIL_PROVIDER: "typo" }, { AUTH_EMAIL_FALLBACK_PROVIDER: "typo" }, { AUTH_EMAIL_FROM: "" },
  ]) assert.throws(() => requireAuthEmailConfig({ ...env, ...overrides }));
});

test("Resend success never sends a second email", async (context) => {
  const calls = mockRequests(context, [Response.json({ id: "resend-message" })]);
  await deliverAuthEmail(message, requireAuthEmailConfig(env));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(JSON.parse(String(calls[0].options.body)).html, message.html);
});

for (const reason of ["monthly_quota_exceeded", "daily_quota_exceeded", "rate_limit_exceeded"]) {
  test(`${reason} falls back once using a signed POST with identical content`, async (context) => {
    const calls = mockRequests(context, [rejected(reason), accepted()]);
    await deliverAuthEmail(message, requireAuthEmailConfig(env));
    assert.equal(calls.length, 2);
    const fallback = calls[1];
    assert.equal(fallback.url, "https://dm.aliyuncs.com/");
    assert.equal(fallback.options.method, "POST");
    assert.equal(fallback.options.redirect, "error");
    assert.ok(fallback.options.signal instanceof AbortSignal);
    assert.match(new Headers(fallback.options.headers).get("content-type")!, /application\/x-www-form-urlencoded/);
    const payload = body(fallback);
    assert.equal(payload.get("AccountName"), env.ALIYUN_DM_ACCOUNT_NAME);
    assert.equal(payload.get("FromAlias"), AUTH_EMAIL_BRAND);
    assert.equal(payload.get("Action"), "SingleSendMail");
    assert.equal(payload.get("Version"), "2015-11-23");
    assert.equal(payload.get("AddressType"), "1");
    assert.equal(payload.get("ReplyToAddress"), "false");
    assert.equal(payload.get("ClickTrace"), "0");
    assert.equal(payload.get("ToAddress"), message.to);
    assert.equal(payload.get("HtmlBody"), message.html);
    assert.equal(payload.get("TextBody"), message.text);
    assert.equal(payload.get("Subject"), message.subject);
    assert.match(payload.get("Timestamp")!, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.equal(payload.get("Signature"), signAliyunParameters(Object.fromEntries(payload), env.ALIYUN_DM_ACCESS_KEY_SECRET));
    assert.equal(payload.has("AccessKeySecret"), false);
  });
}

test("manual Aliyun mode skips Resend, supports all configured regions and generates fresh nonces", async (context) => {
  const calls = mockRequests(context, Object.keys(ALIYUN_DM_ENDPOINTS).map(accepted));
  for (const [region, endpoint] of Object.entries(ALIYUN_DM_ENDPOINTS)) {
    await deliverAuthEmail(message, requireAuthEmailConfig({
      ...env, AUTH_EMAIL_PROVIDER: "aliyun", AUTH_EMAIL_FALLBACK_PROVIDER: "none", RESEND_API_KEY: "", ALIYUN_DM_REGION_ID: region,
    }));
    assert.equal(calls.at(-1)!.url, endpoint);
    assert.equal(body(calls.at(-1)!).get("RegionId"), region);
  }
  assert.equal(new Set(calls.map((call) => body(call).get("SignatureNonce"))).size, calls.length);
});

for (const [reason, status] of [
  ["validation_error", 422], ["invalid_api_key", 401], ["suspended_api_key", 403],
  ["application_error", 500], ["service_unavailable", 503], ["unknown_error", 429],
] as const) {
  test(`${reason} does not trigger cross-provider resending`, async (context) => {
    const calls = mockRequests(context, [rejected(reason, status)]);
    await assert.rejects(deliverAuthEmail(message, requireAuthEmailConfig(env)), /no automatic fallback/);
    assert.equal(calls.length, 1);
  });
}

test("network failure or unacknowledged Resend response never double-sends", async (context) => {
  const calls = mockRequests(context, [new Error("request timed out"), Response.json({})]);
  await assert.rejects(deliverAuthEmail(message, requireAuthEmailConfig(env)), /no automatic fallback/);
  await assert.rejects(deliverAuthEmail(message, requireAuthEmailConfig(env)), /no automatic fallback/);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.url === "https://api.resend.com/emails"));
});

test("quota rejection with disabled fallback remains a failure", async (context) => {
  const calls = mockRequests(context, [rejected("monthly_quota_exceeded")]);
  await assert.rejects(deliverAuthEmail(message, requireAuthEmailConfig(primaryEnv)), /fallback is not configured/);
  assert.equal(calls.length, 1);
});

test("Aliyun failures are surfaced without exposing response bodies or retrying", async (context) => {
  const failures = [
    new Response("private token and recipient", { status: 400 }),
    new Response("<html>login page</html>"),
    Response.json({ Code: "InvalidToAddress.Spam", Message: "private token and recipient" }),
    Response.json({ Code: "Rejected", EnvId: "not-accepted" }),
    Response.json({ RequestId: "request-only" }), Response.json({ EnvId: "" }),
    Response.json(null), new Error("private token and recipient"),
  ];
  const calls = mockRequests(context, failures.flatMap((failure) => [rejected("monthly_quota_exceeded"), failure]));
  for (let i = 0; i < failures.length; i++) {
    await assert.rejects(deliverAuthEmail(message, requireAuthEmailConfig(env)), (error: Error) => {
      assert.match(error.message, /Aliyun/);
      assert.doesNotMatch(error.message, /private token|recipient@example|123456/);
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(calls.length, (i + 1) * 2);
  }
});

test("Aliyun never sends an authentication secret to multiple recipients", async (context) => {
  const calls = mockRequests(context, []);
  await assert.rejects(deliverAuthEmail({ ...message, to: "one@example.test,two@example.test" },
    requireAuthEmailConfig({ ...env, AUTH_EMAIL_PROVIDER: "aliyun" })), /one recipient/);
  assert.equal(calls.length, 0);
});

test("registration and reset entry points preserve content when falling back", async (context) => {
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  context.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const calls = mockRequests(context, [rejected("monthly_quota_exceeded"), accepted(), rejected("monthly_quota_exceeded"), accepted()]);
  const { sendAuthEmail } = await import("./email.ts");
  await sendAuthEmail({ to: message.to, kind: "verify-code", code: "123456" });
  await sendAuthEmail({ to: message.to, kind: "reset", url: "https://example.test/reset?token=secret&next=home" });
  assert.equal(calls.length, 4);
  for (const index of [0, 2]) {
    const primary = JSON.parse(String(calls[index].options.body));
    const fallback = body(calls[index + 1]);
    assert.equal(fallback.get("HtmlBody"), primary.html);
    assert.equal(fallback.get("TextBody"), primary.text);
    assert.equal(fallback.get("Subject"), primary.subject);
    assert.equal(fallback.get("ToAddress"), message.to);
  }
  assert.match(body(calls[1]).get("HtmlBody")!, /123456/);
  assert.match(body(calls[3]).get("HtmlBody")!, /token=secret&amp;next=home/);
});
