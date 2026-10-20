import assert from "node:assert/strict";
import test from "node:test";

import {
  TELEMETRY_TTL_MS,
  telemetryEventValues,
  validateTelemetryEvent,
  telemetryValidationIssue,
} from "./telemetry.ts";

const validEvent = {
  sessionId: "4d5b9a39-02f8-4e3f-bf0a-3e0f99880945",
  type: "performance",
  name: "web_vitals_lcp",
  durationMs: 1234,
  page: "/training",
  meta: { device_type: "desktop", dpr: 1.25, save_data: false },
};

test("invalid telemetry reports schema paths without retaining submitted values",()=>{
  assert.equal(telemetryValidationIssue(validEvent),null);
  assert.equal(telemetryValidationIssue({...validEvent,durationMs:-1})?.path,"durationMs");
  assert.equal(telemetryValidationIssue({...validEvent,page:"x".repeat(121)})?.path,"page");
  const issue=telemetryValidationIssue({...validEvent,meta:{token:"PRIVATE"}});
  assert.equal(issue?.path,"meta"); assert.doesNotMatch(JSON.stringify(issue),/PRIVATE|token/);
});

test("telemetry validation accepts only the public field whitelist", () => {
  assert.deepEqual(validateTelemetryEvent(validEvent), validEvent);
  assert.ok(validateTelemetryEvent({
    ...validEvent,
    type: "interaction",
    name: "upgrade_simulation_submit",
  }));
  assert.ok(validateTelemetryEvent({
    ...validEvent,
    type: "interaction",
    name: "upgrade_simulation_response",
  }));
  assert.equal(validateTelemetryEvent({ ...validEvent, createdAt: Date.now() }), null);
  assert.equal(validateTelemetryEvent({ ...validEvent, token: "secret" }), null);
  assert.equal(validateTelemetryEvent({ ...validEvent, meta: { unknown: "value" } }), null);
  assert.equal(validateTelemetryEvent({ ...validEvent, meta: { os: "x".repeat(121) } }), null);
});

test("telemetry validation rejects values that cannot fit the database contract", () => {
  assert.equal(validateTelemetryEvent({ ...validEvent, durationMs: -1 }), null);
  assert.equal(validateTelemetryEvent({ ...validEvent, durationMs: 2_147_483_648 }), null);
  assert.equal(validateTelemetryEvent({ ...validEvent, value: 1.5 }), null);
  assert.equal(validateTelemetryEvent({ ...validEvent, meta: { dpr: Number.POSITIVE_INFINITY } }), null);
});

test("telemetry rows use server receipt time and expire after exactly 30 days", () => {
  const event = validateTelemetryEvent(validEvent);
  assert.ok(event);
  const now = new Date("2026-08-27T00:00:00.000Z");
  const row = telemetryEventValues(event, {
    id: "event-1",
    userId: "user-1",
    dataOwnerTag: "owner-tag",
    now,
  });
  assert.equal(row.id, "event-1");
  assert.equal(row.userId, "user-1");
  assert.equal(row.dataOwnerTag, "owner-tag");
  assert.equal(row.createdAt, now);
  assert.equal(row.expiresAt.getTime(), now.getTime() + TELEMETRY_TTL_MS);
});
