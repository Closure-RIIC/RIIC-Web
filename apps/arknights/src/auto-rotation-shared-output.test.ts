import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { prepareMaaForExport } from "@riic/arknights-domain/maa-safety";
import { normalizePersistedPlanData } from "@riic/arknights-domain/persistence";
import { normalizeRotationResult } from "@riic/arknights-domain/rotation-result";
import type { BaseBlueprint, PlanApiResponse, PublicPlanData } from "@riic/arknights-domain/types";
import { toPublicPlanData } from "@riic/platform-server/public-plan";

const fixture = JSON.parse(readFileSync(new URL("../../../e2e/fixtures/auto-main-backup-public.json", import.meta.url), "utf8")) as {
  layout: BaseBlueprint;
  data: PublicPlanData;
};

function internalResult(data: PublicPlanData): PlanApiResponse {
  return {
    success: true,
    profileJson: data.profile,
    maaJson: data.maa,
    rotationJson: data.rotation,
    durationMs: data.durationMs,
    runId: "automatic-shared-result",
    command: "private solver command",
    stdout: "private solver output",
  };
}

test("automatic metadata and warnings survive the shared public and persisted result boundaries", () => {
  const data = structuredClone(fixture.data);
  const metadata = data.rotation.auto_rotation!;
  // An incomplete assignment is a valid result that must retain its warnings.
  metadata.complete = false;
  metadata.rooms[0]!.backup_complete = false;
  metadata.rooms[0]!.backup_missing_seats = 1;
  const expectedMetadata = structuredClone(metadata);
  const warnings = ["自动轮换替补队列存在缺位，请核对设施配置。"];
  Object.assign(data.rotation, { warnings: [...warnings, 17, { private: true }], future_output: "private" });
  Object.assign(metadata, { future_metadata: "private", solver: { executable: "private" } });
  Object.assign(metadata.timing, { future_timing: "private" });
  Object.assign(metadata.rooms[0]!, { future_room: "private" });

  const normalized = normalizeRotationResult({ source: data.rotation, profile: data.profile, fallbackProfile: "main_backup_24_24" });
  assert.deepEqual(normalized.auto_rotation, expectedMetadata);
  assert.deepEqual(normalized.warnings, warnings);
  assert.equal("future_output" in normalized, false);

  const publicData = toPublicPlanData(internalResult(data), {
    layout: fixture.layout, layoutLabel: "243", sourceName: "公开回归样例",
  }, "automatic-public");
  assert.deepEqual(publicData.rotation.auto_rotation, expectedMetadata);
  assert.deepEqual(publicData.rotation.warnings, warnings);
  assert.equal(publicData.rotation.profile, "main_backup_24_24");
  assert.equal(publicData.maa.plans.length, 2);
  assert.equal("debug" in publicData, false);
  assert.equal("command" in publicData, false);

  const restored = normalizePersistedPlanData(JSON.parse(JSON.stringify({
    ...publicData, debug: { stdout: "private" }, future_output: "private",
  })), "auto_24_24");
  assert.ok(restored);
  assert.deepEqual(restored.rotation.auto_rotation, expectedMetadata);
  assert.deepEqual(restored.rotation.warnings, warnings);
  assert.equal("debug" in restored, false);
  assert.equal("future_output" in restored, false);
  assert.deepEqual(restored.maa, publicData.maa);
});

test("automatic MAA output keeps normal Fiammetta and drone actions through export", () => {
  const data = toPublicPlanData(internalResult(structuredClone(fixture.data)), {
    layout: fixture.layout, layoutLabel: "243", sourceName: "公开回归样例",
  }, "automatic-actions");
  const exported = prepareMaaForExport(data.maa, false, false);
  assert.equal(exported.plans.length, 2);
  assert.ok(exported.plans.some(plan => plan.Fiammetta?.enable));
  assert.ok(exported.plans.some(plan => plan.drones?.enable));
  assert.deepEqual(exported.plans.map(plan => plan.Fiammetta), data.maa.plans.map(plan => plan.Fiammetta));
  assert.deepEqual(exported.plans.map(plan => plan.drones), data.maa.plans.map(plan => plan.drones));
});

test("ordinary 24/24 main-backup output does not acquire an automatic identity", () => {
  const data = structuredClone(fixture.data);
  delete data.rotation.auto_rotation;
  const publicData = toPublicPlanData(internalResult(data), {
    layout: fixture.layout, layoutLabel: "243", sourceName: "公开回归样例",
  }, "ordinary-main-backup");
  const restored = normalizePersistedPlanData(publicData, "main_backup_24_24");
  assert.ok(restored);
  assert.equal(restored.rotation.profile, "main_backup_24_24");
  assert.deepEqual(restored.rotation.shifts.map(shift => shift.duration_hours), [24, 24]);
  assert.equal("auto_rotation" in publicData.rotation, false);
  assert.equal("auto_rotation" in restored.rotation, false);
});
