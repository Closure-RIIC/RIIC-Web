import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isAutoRotationHours, type AutoRotationResult } from "@riic/arknights-domain/auto-rotation";
import {
  createAutoRotationPost,
  type AutoRotationPostDependencies,
} from "../app/api/auto-rotation/route.ts";
import { planAccessMode } from "./plan-access.ts";

const routerSource = readFileSync(new URL("../routes/api.auto-rotation.ts", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../app/api/auto-rotation/route.ts", import.meta.url), "utf8");

const layout = {
  template: "243",
  drone_cap: 0,
  scenario: {},
  rooms: [{ id: "trade_1", kind: "trade_post", level: 3 }],
};
const personalOperbox = [{
  id: "char_personal",
  name: "Personal",
  own: true,
  elite: 2,
  level: 80,
  potential: 1,
  rarity: 5,
}];
const sampleOperbox = [{ ...personalOperbox[0], id: "char_sample", name: "Sample" }];
const result = {
  mode: "auto",
  hours: [24, 12],
  complete: true,
  rooms: [],
  dormSupport: [],
  fiammetta: null,
  warnings: [],
  durationMs: 1,
  diagnosticId: "diagnostic-id",
} satisfies AutoRotationResult;

type Calls = {
  anonymousAcquired: number;
  anonymousReleased: number;
  localAcquired: number;
  localReleased: number;
  reservations: Array<Record<string, unknown>>;
  finishes: Array<[string, string]>;
  runs: Array<Record<string, unknown>>;
};

function dependencies(
  calls: Calls,
  overrides: Partial<AutoRotationPostDependencies> = {},
): AutoRotationPostDependencies {
  const base = {
    isAutoRotationHours,
    validateLayoutJson: () => [],
    assertOperbox: (value: unknown) => value,
    acquireAnonymousSamplePlanSlot: () => {
      calls.anonymousAcquired += 1;
      return () => { calls.anonymousReleased += 1; };
    },
    acquirePlanSlot: () => {
      calls.localAcquired += 1;
      return () => { calls.localReleased += 1; };
    },
    assertPlanCollectionLimits: () => undefined,
    assertSameOrigin: () => undefined,
    createRequestId: () => "request-id",
    failureResponse: (error: unknown) => new Response(JSON.stringify({
      code: error && typeof error === "object" && "code" in error ? error.code : "AIC-SYS-5000",
    }), { status: 400 }),
    normalizeFiammettaEnable: (value: unknown) => value !== false,
    planAccountAdmissionClass: () => "established",
    readJsonBody: (request: Request) => request.json(),
    requestClientIp: () => "203.0.113.10",
    successResponse: (value: unknown) => new Response(JSON.stringify(value), { status: 200 }),
    localTestSession: () => null,
    requireWebsiteSession: async () => ({ user: { id: "user-1" } }),
    readWebsiteSession: async () => null,
    isPlanTaskQueueEnabled: () => false,
    planCacheHmacKey: () => Buffer.alloc(32, 1),
    getSampleOperbox: async () => ({ operbox: sampleOperbox, sourceName: "sample" }),
    runAutoRotation: async (input: Record<string, unknown>) => {
      calls.runs.push(input);
      return result;
    },
    planAccessMode,
    createSynchronousAutoRotationReservation: async (input: Record<string, unknown>) => {
      calls.reservations.push(input);
      return { id: "reservation-1" };
    },
    finishSynchronousAutoRotationReservation: async (id: string, outcome: string) => {
      calls.finishes.push([id, outcome]);
    },
    planTaskIpHmac: () => "ip-hmac",
  };
  return { ...base, ...overrides } as unknown as AutoRotationPostDependencies;
}

function createCalls(): Calls {
  return {
    anonymousAcquired: 0,
    anonymousReleased: 0,
    localAcquired: 0,
    localReleased: 0,
    reservations: [],
    finishes: [],
    runs: [],
  };
}

function request(body: Record<string, unknown>, signal?: AbortSignal): Request {
  return new Request("https://example.test/api/auto-rotation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

test("automatic rotation rejects CSRF and invalid sub-minute hours before admission", async () => {
  const csrfCalls = createCalls();
  const csrfPost = createAutoRotationPost(dependencies(csrfCalls, {
    assertSameOrigin: () => { throw new Error("csrf"); },
  }));
  assert.equal((await csrfPost(request({ layout, operbox: personalOperbox, hours: [24, 12] }))).status, 400);
  assert.equal(csrfCalls.runs.length, 0);
  assert.equal(csrfCalls.reservations.length, 0);

  const hoursCalls = createCalls();
  const hoursPost = createAutoRotationPost(dependencies(hoursCalls));
  const response = await hoursPost(request({ layout, operbox: personalOperbox, hours: [0.01, 12] }));
  assert.equal(response.status, 400);
  assert.equal(hoursCalls.runs.length, 0);
  assert.equal(hoursCalls.localAcquired, 0);
});

test("anonymous sample input is replaced by the server pool and releases its slot", async () => {
  const calls = createCalls();
  const post = createAutoRotationPost(dependencies(calls));
  const response = await post(request({
    layout,
    boxSource: "sample",
    hours: [24, 12],
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(calls.runs[0]?.operbox, sampleOperbox);
  assert.equal(calls.anonymousAcquired, 1);
  assert.equal(calls.anonymousReleased, 1);
  assert.equal(calls.localAcquired, 0);
  assert.equal(calls.reservations.length, 0);
});

test("sample mode rejects a client-supplied operator pool", async () => {
  const calls = createCalls();
  const post = createAutoRotationPost(dependencies(calls));
  const response = await post(request({
    layout,
    operbox: personalOperbox,
    boxSource: "sample",
    hours: [24, 12],
  }));
  assert.equal(response.status, 400);
  assert.equal(calls.runs.length, 0);
  assert.equal(calls.anonymousAcquired, 0);
  assert.equal(calls.reservations.length, 0);
});

test("queue-enabled authenticated personal and sample runs share database admission", async () => {
  for (const boxSource of ["maa", "sample"] as const) {
    const calls = createCalls();
    const post = createAutoRotationPost(dependencies(calls, {
      isPlanTaskQueueEnabled: () => true,
      readWebsiteSession: async () => ({ user: { id: "user-1" } }) as never,
    }));
    const body: Record<string, unknown> = {
      layout,
      boxSource,
      hours: [24, 12],
    };
    if (boxSource === "maa") body.operbox = personalOperbox;
    const response = await post(request(body));
    assert.equal(response.status, 200);
    assert.deepEqual(calls.reservations, [{
      userId: "user-1",
      accountClass: "established",
      requestIpHmac: "ip-hmac",
    }]);
    assert.deepEqual(calls.finishes, [["reservation-1", "success"]]);
    assert.equal(calls.localAcquired, 0);
    assert.equal(calls.anonymousAcquired, 0);
  }
});

test("database reservations are finalized for solver failure and request cancellation", async () => {
  for (const scenario of ["failed", "cancelled"] as const) {
    const calls = createCalls();
    const controller = new AbortController();
    if (scenario === "cancelled") controller.abort();
    const post = createAutoRotationPost(dependencies(calls, {
      isPlanTaskQueueEnabled: () => true,
      runAutoRotation: async () => { throw new Error(scenario); },
    }));
    const response = await post(request(
      { layout, operbox: personalOperbox, hours: [24, 12] },
      controller.signal,
    ));
    assert.equal(response.status, 400);
    assert.deepEqual(calls.finishes, [["reservation-1", scenario]]);
  }
});

test("non-queued personal admission releases its in-process slot on failure", async () => {
  const calls = createCalls();
  const post = createAutoRotationPost(dependencies(calls, {
    runAutoRotation: async () => { throw new Error("failed"); },
  }));
  assert.equal((await post(request({ layout, operbox: personalOperbox, hours: [24, 12] }))).status, 400);
  assert.equal(calls.localAcquired, 1);
  assert.equal(calls.localReleased, 1);
});

test("automatic rotation does not use the plan cache or mutate account configuration", () => {
  assert.equal(routeSource.includes("resolvePlanCache"), false);
  assert.equal(routeSource.includes("completePlanCache"), false);
  assert.equal(routeSource.includes("saveWorkspace"), false);
  assert.equal(routeSource.includes("updateAccount"), false);
});

test("automatic rotation route exposes POST only", () => {
  assert.ok(routerSource.includes('createFileRoute("/api/auto-rotation")'));
  assert.ok(routerSource.includes('fallbackApiMethod(request, ["POST"])'));
  assert.ok(routerSource.includes("POST: ({ request }) => api.POST(request)"));
});
