import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  __resetRequestGuardsForTests,
  acquireAnonymousSamplePlanSlot,
  acquirePlanSlot,
  assertEmptyBody,
  assertFiammettaEnableCompatible,
  assertPlanCollectionLimits,
  assertSameOrigin,
  enforceRateLimit,
  ERROR_DEFINITIONS,
  failureResponse,
  healthHttpStatus,
  MAX_CONCURRENT_AUTHENTICATED_PLAN_ADMISSIONS,
  MAX_CONCURRENT_ANONYMOUS_SAMPLE_PLAN_ADMISSIONS,
  MAX_CONCURRENT_NEW_ACCOUNT_PLAN_ADMISSIONS,
  MAX_ANONYMOUS_SAMPLE_PLAN_STARTS_PER_IP,
  MAX_CONCURRENT_PLAN_ACCOUNTS_PER_IP,
  MAX_PLAN_STARTS_PER_ACCOUNT,
  MAX_PLAN_STARTS_PER_IP,
  normalizeFiammettaEnable,
  planAccountAdmissionClass,
  PLAN_ESTABLISHED_ACCOUNT_AGE_MS,
  PublicApiError,
  readJsonBody,
  successResponse,
  validateFeedbackRequest,
} from "./api-contract.ts";
import {
  enforceSklandPollRateLimit,
  MAX_SKLAND_POLLS_PER_ACCOUNT,
  MAX_SKLAND_POLLS_PER_IP,
  SKLAND_POLL_RATE_WINDOW_MS,
} from "./skland/poll-rate-limit.ts";

test("error catalog keeps the required HTTP status mapping", () => {
  assert.equal(ERROR_DEFINITIONS["AIC-REQ-1001"].status, 400);
  assert.equal(ERROR_DEFINITIONS["AIC-REQ-1002"].status, 413);
  assert.equal(ERROR_DEFINITIONS["AIC-BOX-1101"].status, 422);
  assert.equal(ERROR_DEFINITIONS["AIC-LAYOUT-1201"].status, 422);
  assert.equal(ERROR_DEFINITIONS["AIC-AUTH-2001"].status, 401);
  assert.equal(ERROR_DEFINITIONS["AIC-AUTH-2002"].status, 403);
  assert.equal(ERROR_DEFINITIONS["AIC-AUTH-2003"].status, 503);
  assert.equal(ERROR_DEFINITIONS["AIC-AUTH-2004"].status, 409);
  assert.equal(ERROR_DEFINITIONS["AIC-AUTH-2005"].status, 400);
  assert.equal(ERROR_DEFINITIONS["AIC-AUTH-2006"].status, 409);
  assert.equal(ERROR_DEFINITIONS["AIC-AUTH-2007"].status, 404);
  assert.equal(ERROR_DEFINITIONS["AIC-AUTH-2010"].status, 400);
  assert.equal(ERROR_DEFINITIONS["AIC-PLAN-3001"].status, 503);
  assert.equal(ERROR_DEFINITIONS["AIC-PLAN-3002"].status, 429);
  assert.equal(ERROR_DEFINITIONS["AIC-PLAN-3003"].status, 504);
  assert.equal(ERROR_DEFINITIONS["AIC-PLAN-3004"].status, 502);
  assert.equal(ERROR_DEFINITIONS["AIC-PLAN-3005"].status, 409);
  assert.equal(ERROR_DEFINITIONS["AIC-PLAN-3006"].status, 429);
  assert.equal(ERROR_DEFINITIONS["AIC-PLAN-3007"].status, 429);
  assert.equal(ERROR_DEFINITIONS["AIC-PLAN-3008"].status, 503);
  assert.equal(ERROR_DEFINITIONS["AIC-FEEDBACK-4001"].status, 422);
  assert.equal(ERROR_DEFINITIONS["AIC-FEEDBACK-4002"].status, 500);
  assert.equal(ERROR_DEFINITIONS["AIC-SYS-5000"].status, 500);
  assert.equal(ERROR_DEFINITIONS["AIC-RATE-6001"].status, 429);
  assert.equal(ERROR_DEFINITIONS["AIC-DATA-8001"].status, 403);
  assert.equal(ERROR_DEFINITIONS["AIC-DATA-8002"].status, 503);
  assert.equal(ERROR_DEFINITIONS["AIC-DATA-8003"].status, 422);
  assert.equal(ERROR_DEFINITIONS["AIC-DATA-8004"].status, 404);
});

test("success and failure responses include the request id", async () => {
  const success = successResponse({ plannerReady: false }, "request-1", 503);
  assert.equal(success.status, 503);
  assert.equal(success.headers.get("X-Request-Id"), "request-1");
  assert.equal(success.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(await success.json(), {
    success: true,
    data: { plannerReady: false },
    requestId: "request-1",
  });

  const failure = failureResponse(
    new PublicApiError("AIC-RATE-6001", { retryAfter: 7 }),
    "request-2",
    "/test",
    performance.now()
  );
  assert.equal(failure.status, 429);
  assert.equal(failure.headers.get("X-Request-Id"), "request-2");
  assert.equal(failure.headers.get("Cache-Control"), "private, no-store");
  assert.equal(failure.headers.get("Retry-After"), "7");
  const body = await failure.json();
  assert.equal(body.error.requestId, "request-2");
  assert.equal(body.error.code, "AIC-RATE-6001");
  assert.equal(body.error.retryAfterSeconds, 7);
});

test("persistent plan admission errors expose Retry-After in both response boundaries", async () => {
  for (const [code, retryAfter] of [
    ["AIC-PLAN-3006", 45],
    ["AIC-PLAN-3007", 60],
    ["AIC-PLAN-3008", 30],
  ] as const) {
    const response = failureResponse(
      new PublicApiError(code, { retryAfter }),
      `request-${code}`,
      "/api/tasks",
      performance.now(),
    );
    assert.equal(response.headers.get("Retry-After"), String(retryAfter));
    const body = await response.json();
    assert.equal(body.error.code, code);
    assert.equal(body.error.retryAfterSeconds, retryAfter);
  }
});

test("health returns 503 while the planner is unavailable", () => {
  assert.equal(healthHttpStatus(false), 503);
  assert.equal(healthHttpStatus(true), 200);
});

test("readJsonBody rejects malformed and oversized requests", async () => {
  await assert.rejects(
    readJsonBody(new Request("http://localhost/api", { method: "POST", body: "{" }), 128),
    (error: unknown) => error instanceof PublicApiError && error.code === "AIC-REQ-1001"
  );
  await assert.rejects(
    readJsonBody(new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-length": "129" },
      body: "{}",
    }), 128),
    (error: unknown) => error instanceof PublicApiError && error.code === "AIC-REQ-1002"
  );
  await assert.rejects(
    readJsonBody(new Request("http://localhost/api", {
      method: "POST",
      body: "x".repeat(129),
    }), 128),
    (error: unknown) => error instanceof PublicApiError && error.code === "AIC-REQ-1002"
  );
});

test("empty-body actions accept an empty stream while preserving request size limits", async () => {
  await assert.doesNotReject(
    assertEmptyBody(new Request("http://localhost/api", { method: "POST" }), 128)
  );
  await assert.rejects(
    assertEmptyBody(new Request("http://localhost/api", { method: "POST", body: "{}" }), 128),
    (error: unknown) => error instanceof PublicApiError && error.code === "AIC-REQ-1001"
  );
  await assert.rejects(
    assertEmptyBody(new Request("http://localhost/api", { method: "POST", body: "x".repeat(129) }), 128),
    (error: unknown) => error instanceof PublicApiError && error.code === "AIC-REQ-1002"
  );
});

test("same-origin protection rejects a mismatched Origin", () => {
  const previousPublicOrigin = process.env.BETA_PUBLIC_ORIGIN;
  try {
    delete process.env.BETA_PUBLIC_ORIGIN;
    assert.throws(
      () => assertSameOrigin(new Request("https://product.example/api/plan", {
        method: "POST",
        headers: { Origin: "https://attacker.example" },
      })),
      (error: unknown) => error instanceof PublicApiError && error.code === "AIC-AUTH-2002"
    );
    assert.doesNotThrow(() => assertSameOrigin(new Request("https://product.example/api/plan", {
      method: "POST",
      headers: { Origin: "https://product.example" },
    })));
  } finally {
    if (previousPublicOrigin === undefined) delete process.env.BETA_PUBLIC_ORIGIN;
    else process.env.BETA_PUBLIC_ORIGIN = previousPublicOrigin;
  }
});

test("general API origin checks do not inherit the Skland-only public origin", () => {
  const previousPublicOrigin = process.env.BETA_PUBLIC_ORIGIN;
  const previousSklandOrigin = process.env.SKLAND_PUBLIC_ORIGIN;
  try {
    delete process.env.BETA_PUBLIC_ORIGIN;
    process.env.SKLAND_PUBLIC_ORIGIN = "https://skland.example";
    assert.doesNotThrow(() => assertSameOrigin(new Request("http://127.0.0.1:5177/api/plan", {
      method: "POST",
      headers: { Origin: "http://127.0.0.1:5177" },
    })));
  } finally {
    if (previousPublicOrigin === undefined) delete process.env.BETA_PUBLIC_ORIGIN;
    else process.env.BETA_PUBLIC_ORIGIN = previousPublicOrigin;
    if (previousSklandOrigin === undefined) delete process.env.SKLAND_PUBLIC_ORIGIN;
    else process.env.SKLAND_PUBLIC_ORIGIN = previousSklandOrigin;
  }
});

test("same-origin protection uses Host instead of the wildcard listen address", () => {
  const previousPublicOrigin = process.env.BETA_PUBLIC_ORIGIN;
  try {
    delete process.env.BETA_PUBLIC_ORIGIN;
    assert.doesNotThrow(() => assertSameOrigin(new Request("http://0.0.0.0:5177/api/plan", {
      method: "POST",
      headers: {
        Host: "127.0.0.1:5177",
        Origin: "http://127.0.0.1:5177",
      },
    })));
  } finally {
    if (previousPublicOrigin === undefined) delete process.env.BETA_PUBLIC_ORIGIN;
    else process.env.BETA_PUBLIC_ORIGIN = previousPublicOrigin;
  }
});

test("feedback validation separates issue kinds and requires a complete private reproduction snapshot", () => {
  const reproduction = {
    layout: {
      template: "243",
      drone_cap: 200,
      scenario: {},
      rooms: [
        { id: "control", kind: "control_center", level: 5 },
        { id: "power", kind: "power_plant", level: 3 },
      ],
    },
    operbox: [{
      id: "char_002_amiya",
      name: "阿米娅",
      own: true,
      level: 80,
      elite: 2,
      potential: 6,
      rarity: 5,
    }],
    rotation: "abc_12_6_6",
    fiammettaEnabled: false,
    sourceType: "maa",
  };
  const valid = {
    diagnosticId: "diag",
    room: { id: "trade_1", title: "贸易站 1", group: "trading", operators: ["能天使"] },
    note: "站位不符合预期",
    consent: true as const,
    reproduction,
  };
  assert.doesNotThrow(() => validateFeedbackRequest(valid));
  assert.doesNotThrow(() => validateFeedbackRequest({
    kind: "performance_issue",
    diagnosticId: "diag",
    note: "运行耗时明显偏长",
    consent: true,
    reproduction,
  }));
  assert.throws(
    () => validateFeedbackRequest({ ...valid, reproduction: undefined }),
    (error: unknown) => error instanceof PublicApiError && error.code === "AIC-FEEDBACK-4001"
  );
  assert.throws(
    () => validateFeedbackRequest({ ...valid, reproduction: { ...reproduction, operbox: [] } }),
    (error: unknown) => error instanceof PublicApiError && error.code === "AIC-FEEDBACK-4001"
  );
  assert.throws(
    () => validateFeedbackRequest({ ...valid, reproduction: { ...reproduction, rotation: "fiammetta_8_8_4_4", fiammettaEnabled: false } }),
    (error: unknown) => error instanceof PublicApiError && error.code === "AIC-FEEDBACK-4001"
  );
  assert.throws(
    () => validateFeedbackRequest({ ...valid, consent: false }),
    (error: unknown) => error instanceof PublicApiError && error.code === "AIC-FEEDBACK-4001"
  );
  assert.throws(
    () => validateFeedbackRequest({ ...valid, note: "x".repeat(1001) }),
    (error: unknown) => error instanceof PublicApiError && error.code === "AIC-FEEDBACK-4001"
  );
  assert.throws(
    () => validateFeedbackRequest({ ...valid, kind: "performance_issue" }),
    (error: unknown) => error instanceof PublicApiError && error.code === "AIC-FEEDBACK-4001"
  );
  assert.throws(
    () => validateFeedbackRequest({ kind: "room_issue", diagnosticId: "diag", note: "缺少房间", consent: true, reproduction }),
    (error: unknown) => error instanceof PublicApiError && error.code === "AIC-FEEDBACK-4001"
  );
  assert.throws(
    () => validateFeedbackRequest({ kind: "future", diagnosticId: "diag", note: "未知类型", consent: true, reproduction }),
    (error: unknown) => error instanceof PublicApiError && error.code === "AIC-FEEDBACK-4001"
  );
});

test("plan collection limits enforce operators, rooms, and source length", () => {
  assert.doesNotThrow(() => assertPlanCollectionLimits(1000, 64, "x".repeat(80)));
  assert.throws(
    () => assertPlanCollectionLimits(1001, 64, "source"),
    (error: unknown) => error instanceof PublicApiError && error.code === "AIC-BOX-1101"
  );
  assert.throws(
    () => assertPlanCollectionLimits(1, 65, "source"),
    (error: unknown) => error instanceof PublicApiError && error.code === "AIC-LAYOUT-1201"
  );
  assert.throws(
    () => assertPlanCollectionLimits(1, 1, "x".repeat(81)),
    (error: unknown) => error instanceof PublicApiError && error.code === "AIC-BOX-1101"
  );
});

test("fiammetta enable normalizes to true by default and rejects non-boolean values", () => {
  assert.equal(normalizeFiammettaEnable(undefined), true);
  assert.equal(normalizeFiammettaEnable(true), true);
  assert.equal(normalizeFiammettaEnable(false), false);
  assert.throws(
    () => normalizeFiammettaEnable("yes"),
    (error: unknown) => error instanceof PublicApiError && error.code === "AIC-REQ-1001"
  );
});

test("fiammetta enable conflicts with the dedicated Fiammetta rotation", () => {
  assert.doesNotThrow(() => assertFiammettaEnableCompatible(true, "fiammetta_8_8_4_4"));
  assert.doesNotThrow(() => assertFiammettaEnableCompatible(false, "abc_12_6_6"));
  assert.throws(
    () => assertFiammettaEnableCompatible(false, "fiammetta_8_8_4_4"),
    (error: unknown) => error instanceof PublicApiError && error.code === "AIC-REQ-1001"
  );
});

test("rate limiting returns retryable 429 errors", () => {
  const previous = process.env.BETA_RATE_LIMIT_ENABLED;
  process.env.BETA_RATE_LIMIT_ENABLED = "1";
  __resetRequestGuardsForTests();
  try {
    enforceRateLimit("test", "ip", 1, 60_000);
    assert.throws(
      () => enforceRateLimit("test", "ip", 1, 60_000),
      (error: unknown) => error instanceof PublicApiError
        && error.code === "AIC-RATE-6001"
        && Boolean(error.retryAfter)
    );
  } finally {
    if (previous === undefined) delete process.env.BETA_RATE_LIMIT_ENABLED;
    else process.env.BETA_RATE_LIMIT_ENABLED = previous;
    __resetRequestGuardsForTests();
  }
});

test("Skland polling uses account-primary limits with shared-IP headroom", () => {
  const previous = process.env.BETA_RATE_LIMIT_ENABLED;
  process.env.BETA_RATE_LIMIT_ENABLED = "1";
  __resetRequestGuardsForTests();
  try {
    assert.equal(SKLAND_POLL_RATE_WINDOW_MS, 10 * 60_000);
    assert.equal(MAX_SKLAND_POLLS_PER_ACCOUNT, 360);
    assert.equal(MAX_SKLAND_POLLS_PER_IP, 3_600);

    for (let index = 0; index < MAX_SKLAND_POLLS_PER_ACCOUNT; index += 1) {
      enforceSklandPollRateLimit("account-a", "shared-ip");
    }
    assert.throws(
      () => enforceSklandPollRateLimit("account-a", "shared-ip"),
      (error: unknown) => error instanceof PublicApiError
        && error.code === "AIC-RATE-6001"
        && Boolean(error.retryAfter),
    );
    assert.doesNotThrow(() => enforceSklandPollRateLimit("account-b", "shared-ip"));

    __resetRequestGuardsForTests();
    for (let index = 0; index < MAX_SKLAND_POLLS_PER_IP; index += 1) {
      enforceSklandPollRateLimit(`account-${index}`, "shared-ip");
    }
    assert.throws(
      () => enforceSklandPollRateLimit("account-overflow", "shared-ip"),
      (error: unknown) => error instanceof PublicApiError && error.code === "AIC-RATE-6001",
    );
  } finally {
    if (previous === undefined) delete process.env.BETA_RATE_LIMIT_ENABLED;
    else process.env.BETA_RATE_LIMIT_ENABLED = previous;
    __resetRequestGuardsForTests();
  }
});

test("authenticated plan admission is account-primary and IP-secondary", () => {
  __resetRequestGuardsForTests();
  try {
    assert.equal(MAX_CONCURRENT_AUTHENTICATED_PLAN_ADMISSIONS, 1_000);
    assert.equal(MAX_CONCURRENT_NEW_ACCOUNT_PLAN_ADMISSIONS, 600);
    assert.equal(MAX_CONCURRENT_PLAN_ACCOUNTS_PER_IP, 100);

    const releaseFirst = acquirePlanSlot({ ip: "shared-ip", accountId: "account-a", accountClass: "established" });
    assert.throws(
      () => acquirePlanSlot({ ip: "other-ip", accountId: "account-a", accountClass: "established" }),
      (error: unknown) => error instanceof PublicApiError && error.code === "AIC-PLAN-3005"
    );

    const sharedIpReleases = Array.from(
      { length: MAX_CONCURRENT_PLAN_ACCOUNTS_PER_IP - 1 },
      (_, index) => acquirePlanSlot({
        ip: "shared-ip",
        accountId: `shared-account-${index}`,
        accountClass: "established",
      }),
    );
    assert.throws(
      () => acquirePlanSlot({ ip: "shared-ip", accountId: "account-c", accountClass: "established" }),
      (error: unknown) => error instanceof PublicApiError && error.code === "AIC-PLAN-3007"
    );

    sharedIpReleases.forEach((release) => release());
    releaseFirst();
  } finally {
    __resetRequestGuardsForTests();
  }
});

test("established accounts can use reserved capacity without opening it to fresh registrations", () => {
  __resetRequestGuardsForTests();
  try {
    const newAccountReleases = Array.from(
      { length: MAX_CONCURRENT_NEW_ACCOUNT_PLAN_ADMISSIONS },
      (_, index) => acquirePlanSlot({
        ip: `new-ip-${index}`,
        accountId: `new-account-${index}`,
        accountClass: "new",
      }),
    );
    assert.throws(
      () => acquirePlanSlot({ ip: "new-ip-rejected", accountId: "new-account-rejected", accountClass: "new" }),
      (error: unknown) => error instanceof PublicApiError && error.code === "AIC-PLAN-3002",
    );

    const establishedReleases = Array.from(
      { length: MAX_CONCURRENT_AUTHENTICATED_PLAN_ADMISSIONS - MAX_CONCURRENT_NEW_ACCOUNT_PLAN_ADMISSIONS },
      (_, index) => acquirePlanSlot({
        ip: `established-ip-${index}`,
        accountId: `established-account-${index}`,
        accountClass: "established",
      }),
    );
    assert.throws(
      () => acquirePlanSlot({ ip: "established-ip-rejected", accountId: "established-account-rejected", accountClass: "established" }),
      (error: unknown) => error instanceof PublicApiError && error.code === "AIC-PLAN-3002",
    );

    establishedReleases.forEach((release) => release());
    newAccountReleases.forEach((release) => release());
  } finally {
    __resetRequestGuardsForTests();
  }
});

test("anonymous trusted samples use one bounded slot while preserving signed-in capacity", () => {
  __resetRequestGuardsForTests();
  try {
    assert.equal(MAX_CONCURRENT_ANONYMOUS_SAMPLE_PLAN_ADMISSIONS, 1);
    const releaseSample = acquireAnonymousSamplePlanSlot({ ip: "sample-ip" });
    assert.throws(
      () => acquireAnonymousSamplePlanSlot({ ip: "other-sample-ip" }),
      (error: unknown) => error instanceof PublicApiError && error.code === "AIC-PLAN-3002",
    );

    const authenticatedReleases = Array.from(
      { length: MAX_CONCURRENT_AUTHENTICATED_PLAN_ADMISSIONS - 1 },
      (_, index) => acquirePlanSlot({
        ip: `authenticated-ip-${index}`,
        accountId: `established-account-${index}`,
        accountClass: "established",
      }),
    );
    assert.throws(
      () => acquirePlanSlot({
        ip: "authenticated-ip-rejected",
        accountId: "established-account-rejected",
        accountClass: "established",
      }),
      (error: unknown) => error instanceof PublicApiError && error.code === "AIC-PLAN-3002",
    );

    authenticatedReleases.forEach((release) => release());
    releaseSample();

    const priorityReleases = Array.from(
      { length: MAX_CONCURRENT_AUTHENTICATED_PLAN_ADMISSIONS - 1 },
      (_, index) => acquirePlanSlot({
        ip: `priority-ip-${index}`,
        accountId: `priority-account-${index}`,
        accountClass: "established",
      }),
    );
    assert.throws(
      () => acquireAnonymousSamplePlanSlot({ ip: "sample-priority-ip" }),
      (error: unknown) => error instanceof PublicApiError && error.code === "AIC-PLAN-3002",
    );
    const releasePriorityAccount = acquirePlanSlot({
      ip: "priority-final-ip",
      accountId: "priority-final-account",
      accountClass: "established",
    });
    releasePriorityAccount();
    priorityReleases.forEach((release) => release());
  } finally {
    __resetRequestGuardsForTests();
  }
});

test("anonymous trusted sample starts allow one retry per IP without charging rejections", () => {
  __resetRequestGuardsForTests();
  try {
    assert.equal(MAX_ANONYMOUS_SAMPLE_PLAN_STARTS_PER_IP, 2);
    const releaseFirst = acquireAnonymousSamplePlanSlot({ ip: "sample-ip" });
    assert.throws(
      () => acquireAnonymousSamplePlanSlot({ ip: "sample-ip" }),
      (error: unknown) => error instanceof PublicApiError && error.code === "AIC-PLAN-3002",
    );
    releaseFirst();
    acquireAnonymousSamplePlanSlot({ ip: "sample-ip" })();
    assert.throws(
      () => acquireAnonymousSamplePlanSlot({ ip: "sample-ip" }),
      (error: unknown) => error instanceof PublicApiError
        && error.code === "AIC-PLAN-3002"
        && Boolean(error.retryAfter),
    );
  } finally {
    __resetRequestGuardsForTests();
  }
});

test("plan account admission class requires verified email and a server-observed 24 hour age", () => {
  const now = Date.parse("2026-08-31T00:00:00.000Z");
  assert.equal(PLAN_ESTABLISHED_ACCOUNT_AGE_MS, 24 * 60 * 60_000);
  assert.equal(planAccountAdmissionClass({
    createdAt: new Date(now - PLAN_ESTABLISHED_ACCOUNT_AGE_MS),
    emailVerified: true,
  }, now), "established");
  assert.equal(planAccountAdmissionClass({
    createdAt: new Date(now - PLAN_ESTABLISHED_ACCOUNT_AGE_MS + 1),
    emailVerified: true,
  }, now), "new");
  assert.equal(planAccountAdmissionClass({
    createdAt: new Date(now - PLAN_ESTABLISHED_ACCOUNT_AGE_MS),
    emailVerified: false,
  }, now), "new");
  assert.equal(planAccountAdmissionClass({
    createdAt: new Date(Number.NaN),
    emailVerified: true,
  }, now), "new");
});

test("plan start windows limit accounts and shared IPs without charging rejected attempts", () => {
  __resetRequestGuardsForTests();
  try {
    assert.equal(MAX_PLAN_STARTS_PER_ACCOUNT, 10);
    for (let index = 0; index < MAX_PLAN_STARTS_PER_ACCOUNT; index += 1) {
      acquirePlanSlot({ ip: "account-ip", accountId: "account-a", accountClass: "established" })();
    }
    assert.throws(
      () => acquirePlanSlot({ ip: "account-ip", accountId: "account-a", accountClass: "established" }),
      (error: unknown) => error instanceof PublicApiError
        && error.code === "AIC-PLAN-3006"
        && Boolean(error.retryAfter)
    );

    __resetRequestGuardsForTests();
    assert.equal(MAX_PLAN_STARTS_PER_IP, 200);
    for (let index = 0; index < MAX_PLAN_STARTS_PER_IP; index += 1) {
      acquirePlanSlot({ ip: "shared-ip", accountId: `account-${index}`, accountClass: "established" })();
    }
    assert.throws(
      () => acquirePlanSlot({ ip: "shared-ip", accountId: "account-rejected", accountClass: "established" }),
      (error: unknown) => error instanceof PublicApiError
        && error.code === "AIC-PLAN-3007"
        && Boolean(error.retryAfter)
    );
  } finally {
    __resetRequestGuardsForTests();
  }
});

test("trusted anonymous samples receive bounded admission after a cache miss", async () => {
  const source = await readFile(new URL("../../../apps/arknights/src/app/api/plan/route.ts", import.meta.url), "utf8");
  const sampleBranch = source.indexOf('=== "trusted-sample"');
  const authenticatedBranch = source.indexOf("} else {", sampleBranch);
  const optionalSession = source.indexOf("await readWebsiteSession(request).catch(() => null)", sampleBranch);
  const sampleUserId = source.indexOf("websiteUserId = optionalSession.user.id", optionalSession);
  const sampleAccountClass = source.indexOf("websiteAccountClass = planAccountAdmissionClass(optionalSession.user)", optionalSession);
  const anonymousGuard = source.indexOf('if (accessMode !== "trusted-sample" || includeDebug)');
  const anonymousAdmission = source.indexOf("release = acquireAnonymousSamplePlanSlot({ ip })");
  const admission = source.indexOf("release = acquirePlanSlot({ ip, accountId: websiteUserId, accountClass: websiteAccountClass })");
  const anonymousSampleReference = 'const cacheReferenceUserId = sourceType === "sample" ? null : websiteUserId';
  assert.equal(optionalSession > sampleBranch, true);
  assert.equal(optionalSession < authenticatedBranch, true);
  assert.equal(sampleUserId > optionalSession && sampleUserId < authenticatedBranch, true);
  assert.equal(sampleAccountClass > optionalSession && sampleAccountClass < authenticatedBranch, true);
  assert.equal(source.includes(anonymousSampleReference), true);
  assert.equal(source.match(/userId: cacheReferenceUserId/g)?.length, 2);
  assert.equal(anonymousGuard > source.indexOf("await resolvePlanCache"), true);
  assert.equal(anonymousGuard < anonymousAdmission, true);
  assert.equal(anonymousAdmission < admission, true);
  assert.equal(admission > source.indexOf("await readJsonBody"), true);
  assert.equal(admission > source.indexOf("await resolvePlanCache"), true);
  assert.equal(admission < source.indexOf("runResult = await runPlan"), true);
});

test("task queue keeps anonymous samples cache-only and applies persistent authenticated admission", async () => {
  const source = await readFile(new URL("../../../apps/arknights/src/app/api/tasks/route.ts", import.meta.url), "utf8");
  const cacheResolution = source.indexOf("await lookupPlanCache");
  const anonymousGuard = source.indexOf("if (!session?.user?.id)");
  const taskCreation = source.indexOf("await createPlanTask");
  assert.equal(cacheResolution > 0, true);
  assert.equal(anonymousGuard > cacheResolution, true);
  assert.equal(taskCreation > anonymousGuard, true);
  assert.equal(source.includes("accountClass: planAccountAdmissionClass(session.user)"), true);
  assert.equal(source.includes("requestIpHmac: planTaskIpHmac(ip, planCacheHmacKey())"), true);
  assert.equal(source.includes("cacheReferenceUserId = sourceType === \"sample\" ? null : userId"), true);
});

test("task queue keeps only the trusted sample on the bounded synchronous endpoint", async () => {
  const source = await readFile(new URL("../../../apps/arknights/src/app/api/plan/route.ts", import.meta.url), "utf8");
  const originGuard = source.indexOf("assertSameOrigin(request)");
  const accessMode = source.indexOf("const accessMode = planAccessMode");
  const queueGuard = source.indexOf('if (taskQueueEnabled && accessMode !== "trusted-sample")');
  const solverCall = source.indexOf("runResult = await runPlan");
  assert.equal(source.includes('throw new PublicApiError("AIC-PLAN-3001")'), true);
  assert.equal(queueGuard > originGuard, true);
  assert.equal(queueGuard > accessMode, true);
  assert.equal(queueGuard < solverCall, true);
});

test("worker finalization records saved-plan bindings and cache ownership before publication", async () => {
  const source = await readFile(new URL("../../../scripts/plan-worker-runtime.mts", import.meta.url), "utf8");
  const runRecord = source.indexOf("await dependencies.recordRun");
  const cacheReference = source.indexOf("await dependencies.recordCacheReference", runRecord);
  const cachePublication = source.indexOf("await dependencies.completeCache", cacheReference);
  const deferredRun = source.indexOf("deferArtifacts: true");
  const solverRunRecord = source.indexOf("await dependencies.recordRun", deferredRun);
  const taskPublication = source.indexOf('await dependencies.completeTask(id, { status: "done"', solverRunRecord);
  const artifactPublication = source.indexOf("dependencies.enqueueArtifact", taskPublication);
  assert.equal(source.includes("calculationContext: savedPlanContext"), true);
  assert.equal(source.includes("publicResultSha256"), true);
  assert.equal(source.includes("operboxContentHmac"), true);
  assert.equal(runRecord > 0, true);
  assert.equal(cacheReference > runRecord, true);
  assert.equal(cachePublication > cacheReference, true);
  assert.equal(deferredRun > 0, true);
  assert.equal(solverRunRecord > deferredRun, true);
  assert.equal(taskPublication > solverRunRecord, true);
  assert.equal(artifactPublication > taskPublication, true);
});

test("worker loads the sealed release environment before evaluating runtime modules", async () => {
  const source = await readFile(new URL("../../../scripts/plan-worker.mts", import.meta.url), "utf8");
  const envLoad = source.indexOf("loadEnvConfig(process.cwd())");
  const runtimeImport = source.indexOf('await import("./plan-worker-runtime.mts")');
  assert.equal(envLoad > 0, true);
  assert.equal(runtimeImport > envLoad, true);
  assert.equal(source.includes('from "./plan-worker-runtime.mts"'), false);
});

test("the client keeps trusted samples synchronous while personal plans follow queue health", async () => {
  const source = await readFile(new URL("../../../apps/arknights/src/App.tsx", import.meta.url), "utf8");
  const healthFlag = source.indexOf("setTaskQueueEnabled(Boolean(health.taskQueue?.enabled))");
  const fallback = source.indexOf('if (!taskQueueEnabled || payload.boxSource === "sample")');
  const synchronousCall = source.indexOf("await computePlan(payload)", fallback);
  const queueCall = source.indexOf("await submitPlanTask(payload)", synchronousCall);
  assert.equal(healthFlag > 0, true);
  assert.equal(fallback > healthFlag, true);
  assert.equal(synchronousCall > fallback, true);
  assert.equal(queueCall > synchronousCall, true);
});
