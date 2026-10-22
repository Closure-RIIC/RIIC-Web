import assert from "node:assert/strict";
import test from "node:test";

import {
  legacyAdminFeedbackStatus,
  normalizeAdminFeedbackStatus,
  toAdminFeedbackRecordData,
  toAdminReproductionData,
} from "./admin-record-dto.ts";

test("admin feedback statuses normalize legacy values to the current review workflow", () => {
  assert.equal(normalizeAdminFeedbackStatus("pending"), "unreviewed");
  assert.equal(normalizeAdminFeedbackStatus("working"), "reproduced");
  assert.equal(normalizeAdminFeedbackStatus("resolved"), "fixed");
  assert.equal(legacyAdminFeedbackStatus("fixed"), "fixed");
  assert.equal(legacyAdminFeedbackStatus("unknown"), null);
  for (const status of ["reviewed", "ignored"]) {
    assert.equal(normalizeAdminFeedbackStatus(status), status);
    assert.equal(legacyAdminFeedbackStatus(status), status);
  }
});

test("admin feedback records classify facilities and whitelist room data", () => {
  const result = toAdminFeedbackRecordData({
    id: "feedback-1",
    diagnosticId: "diagnostic-1",
    planRunDiagnosticId: "diagnostic-1",
    kind: "room_issue",
    room: {
      id: "manu_1",
      title: "制造站 1",
      group: "manufacture",
      operators: ["白面鸮", "红云"],
      private: "must-not-leak",
    },
    note: "排班与预期不同",
    status: "pending",
    adminNote: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    expiresAt: new Date("2026-10-01T00:00:00.000Z"),
  });

  assert.equal(result.facility, "manufacture");
  assert.equal(result.status, "unreviewed");
  assert.equal(result.hasLinkedRun, true);
  assert.deepEqual(result.room, {
    id: "manu_1",
    title: "制造站 1",
    group: "manufacture",
    operators: ["白面鸮", "红云"],
  });
  assert.equal(JSON.stringify(result).includes("must-not-leak"), false);
});

test("admin reproduction DTO requires every solver input and limits itself to the reproduction whitelist", () => {
  const result = toAdminReproductionData({
    diagnosticId: "diagnostic-2",
    layout: {
      template: "243",
      drone_cap: 200,
      scenario: { private: "must-not-leak" },
      rooms: [
        { id: "control", kind: "control_center", level: 5, private: "must-not-leak" },
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
      private: "must-not-leak",
    }],
    context: {
      sourceName: "MAA 导入",
      rotation: "fiammetta_8_8_4_4",
      fiammettaEnabled: true,
      command: "must-not-leak",
    },
    result: { error: "solver exited" },
    stderrExcerpt: "debug tail",
  });

  assert.equal(result.available, true);
  assert.equal(result.unavailableReason, null);
  assert.equal(result.rotation, "fiammetta_8_8_4_4");
  assert.equal(result.rotationCount, 4);
  assert.equal(result.fiammettaEnabled, true);
  assert.equal(result.operbox?.length, 1);
  assert.equal(result.error, "solver exited");
  assert.equal(result.stderrExcerpt, "debug tail");
  assert.equal("command" in result, false);
  assert.equal(JSON.stringify(result).includes("must-not-leak"), false);
});

test("admin reproduction DTO redacts absolute server paths from diagnostic text", () => {
  const result = toAdminReproductionData({
    diagnosticId: "diagnostic-3",
    layout: null,
    operbox: null,
    context: null,
    result: { error: "CLI missing at D:\\Code Rep\\arknights\\infra-cli.exe, retry failed" },
    stderrExcerpt: "worker loaded file:///opt/riic/private/worker.mjs; trace follows",
    stdoutExcerpt: "read /var/lib/arknights-infra/cli-runs/private.json, done",
  });

  assert.equal(result.error, "CLI missing at [已隐藏服务器路径], retry failed");
  assert.equal(result.stderrExcerpt, "worker loaded [已隐藏服务器路径]; trace follows");
  assert.equal(result.stdoutExcerpt, "read [已隐藏服务器路径], done");
  assert.equal(result.unavailableReason, "incomplete");
});

test("admin reproduction DTO redacts credentials from legacy solver output", () => {
  const result = toAdminReproductionData({
    diagnosticId: "diagnostic-secret",
    layout: null,
    operbox: null,
    context: null,
    result: { error: "AUTH_SECRET=s3cr3t\nAuthorization: Bearer bearer-value" },
    stderrExcerpt: '{"access_token":"json-value"} DATABASE_URL=database-value',
    stdoutExcerpt: "Cookie: session=cookie-value; csrf=csrf-value\nread \\\\private-server\\solver-share\\trace.log",
  });

  const serialized = JSON.stringify(result);
  for (const secret of ["s3cr3t", "bearer-value", "json-value", "database-value", "cookie-value", "csrf-value", "private-server", "solver-share"]) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.match(result.error ?? "", /已隐藏敏感值/);
  assert.match(result.stderrExcerpt ?? "", /已隐藏敏感值/);
  assert.match(result.stdoutExcerpt ?? "", /已隐藏服务器路径/);
});

test("admin reproduction DTO preserves a specific unavailable reason", () => {
  const result = toAdminReproductionData({
    diagnosticId: "diagnostic-4",
    layout: null,
    operbox: null,
    context: null,
    result: null,
    unavailableReason: "cache_hit",
  });

  assert.equal(result.available, false);
  assert.equal(result.unavailableReason, "cache_hit");
});
