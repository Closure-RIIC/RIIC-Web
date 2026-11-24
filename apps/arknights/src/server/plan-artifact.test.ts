import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { BaseBlueprint, PublicPlanData } from "@riic/arknights-domain/types";

register("../../../../scripts/ts-path-loader.mjs", import.meta.url);

test("Agent tool projection and calculator page context share final daily output without changing the handoff", async () => {
  const { projectPlanResult } = await import("./agent/plan-artifact.ts");
  const { buildAutomaticScheduleContext } = await import("../agent-page-context.ts");
  const { readAgentDailyProduction } = await import("../agent-plan-production.ts");
  const layout: BaseBlueprint = { template: "153", drone_cap: 200, scenario: {}, rooms: [
    { id: "trade_1", kind: "trade_post", level: 3, product: { trade: { order: "gold" } } },
    { id: "factory_1", kind: "factory", level: 3, product: { factory: { recipe: "originium" } } },
  ] };
  const result: PublicPlanData = {
    diagnosticId: "agent-production-fixture", durationMs: 748,
    profile: { schema_version: 1, layout_label: "153", operbox_label: "sample", baseline_label: "sample", summary: { owned: 438, tier_up_owned: 311, trade_pool_ready: 10 }, domains: [], baseline_rotation: {}, actions: [], flags: [], narration_hints: [], rotation: { daily_manufacture_efficiency: 11.05, daily_trade_efficiency: 2.46 } },
    maa: { title: "153", plans: [{ name: "班次1", duration: 24, rooms: { trading: [{ operators: ["但书"], product: "LMD" }], manufacture: [{ operators: ["温蒂"], product: "Originium Shard" }] }, drones: { enable: true, room: "trading", index: 1, order: "pre" } }] },
    rotation: {
      profile: "abc_12_12_12",
      shifts: [{ index: 0, duration_hours: 24, active_teams: [], resting_team: "", weighted_trade: 2.46, weighted_manu: 11.05, weighted_power: 1.63, scores: { trade_score: 2.46, manu_prod_sum: 11.05, power_charge_sum: 1.63, room_lines: [] } }],
      daily: { trade: 2.46, manufacture: 11.05, power: 1.63,
        production: { lmd: 25_288, pure_gold: 25_500, battle_records: 60_000, originium_shards: 24, orundum: 120 },
        drone_production: { lmd: 500, pure_gold: 0, battle_records: 16_925 } },
    },
  };
  const before = structuredClone(result);
  const projected = projectPlanResult(result, layout);
  const daily = readAgentDailyProduction(projected.dailyProduction)!;
  assert.ok(daily);
  assert.deepEqual(daily.products.map(product => product.value), [76_925, -12_612, 61, 120, 24]);
  assert.deepEqual(projected.efficiencies, result.profile.rotation);
  assert.deepEqual(projected.plans[0].rooms[0].operators, ["但书"]);
  const context = buildAutomaticScheduleContext({ layout, result, scheduleResult: result, activeShift: 0, rows: [] });
  assert.match(context.summary, /预估日均产出（完整轮班折算24小时，已含无人机）/);
  assert.match(context.summary, /净龙门币 -12612 龙门币\/日/);
  assert.match(context.summary, /赤金 61 枚\/日/);
  assert.match(context.summary, /经验 76925 经验\/日/);
  assert.ok(!context.summary.includes("赤金 25500"));
  assert.deepEqual(result, before);
});

test("pending plan envelopes resume into finalized private artifacts", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "arkinfra-artifact-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const storageRoot = path.join(root, "storage");
  const runsRoot = path.join(storageRoot, "cli-runs");
  const runRoot = path.join(runsRoot, "pending-run");
  await mkdir(runRoot, { recursive: true });

  process.env.BETA_STORAGE_DIR = storageRoot;
  process.env.BETA_CLI_RUN_DIR = runsRoot;
  process.env.BETA_FEEDBACK_DIR = path.join(storageRoot, "feedback");
  process.env.BETA_BUSINESS_DB_ENABLED = "0";

  const diagnosticId = "11111111-1111-4111-8111-111111111111";
  const startedAt = new Date().toISOString();
  const ownerTag = "a".repeat(64);
  const envelopePath = path.join(runRoot, "run-envelope.json");
  await writeFile(envelopePath, JSON.stringify({
    version: "plan-run-envelope-v1",
    diagnosticId,
    dataOwnerTag: ownerTag,
    result: {
      success: false,
      startedAt,
      runId: diagnosticId,
      error: "fixture",
    },
  }), "utf-8");

  const {
    finalizePlanArtifactEnvelope,
    PRIVATE_RECORD_TTL_MS,
    resumePendingPlanArtifactFinalizations,
    waitForPlanArtifactFinalizers,
  } = await import("@riic/platform-server/infra");

  assert.equal(PRIVATE_RECORD_TTL_MS, 30 * 24 * 60 * 60 * 1000);

  assert.equal(await resumePendingPlanArtifactFinalizations(), 1);
  assert.equal(await waitForPlanArtifactFinalizers(5_000), true);
  assert.equal(JSON.parse(await readFile(path.join(runRoot, "result.json"), "utf-8")).runId, diagnosticId);
  assert.deepEqual(JSON.parse(await readFile(path.join(runRoot, "owner.json"), "utf-8")), {
    version: 1,
    ownerTag,
    diagnosticId,
    sourceName: null,
    createdAt: startedAt,
  });
  assert.equal(JSON.parse(await readFile(path.join(runRoot, "artifact-expanded.json"), "utf-8")).diagnosticId, diagnosticId);
  assert.equal(JSON.parse(await readFile(path.join(runRoot, "artifact-finalized.json"), "utf-8")).diagnosticId, diagnosticId);
  assert.equal(await resumePendingPlanArtifactFinalizations(), 0);

  const outsideEnvelope = path.join(storageRoot, "outside-envelope.json");
  await writeFile(outsideEnvelope, "{}", "utf-8");
  await assert.rejects(
    finalizePlanArtifactEnvelope(outsideEnvelope),
    /outside private storage/,
  );
  const invalidRunRoot = path.join(runsRoot, "invalid-run");
  await mkdir(invalidRunRoot, { recursive: true });
  await writeFile(path.join(invalidRunRoot, "run-envelope.json"), "{}", "utf-8");
  assert.equal(await resumePendingPlanArtifactFinalizations(), 1);
  assert.equal(await waitForPlanArtifactFinalizers(5_000), true);
  const failed = JSON.parse(await readFile(path.join(invalidRunRoot, "artifact-failed.json"), "utf-8"));
  assert.equal(failed.reason, "invalid-envelope");
  assert.equal(await resumePendingPlanArtifactFinalizations(), 0);

  const orphanRunRoot = path.join(runsRoot, "orphan-run");
  await mkdir(orphanRunRoot, { recursive: true });
  const orphanEnvelopePath = path.join(orphanRunRoot, "run-envelope.json");
  await writeFile(orphanEnvelopePath, JSON.stringify({
    version: "plan-run-envelope-v1",
    diagnosticId: "22222222-2222-4222-8222-222222222222",
    dataOwnerTag: null,
    result: {
      success: false,
      startedAt,
      runId: "22222222-2222-4222-8222-222222222222",
      error: "crashed before recordRun",
    },
  }), "utf-8");
  assert.equal(await resumePendingPlanArtifactFinalizations({
    updateArtifact: async () => "missing",
    missingRunGraceMs: 0,
    retryMs: [],
  }), 1);
  assert.equal(await waitForPlanArtifactFinalizers(5_000), true);
  const orphanFailed = JSON.parse(await readFile(path.join(orphanRunRoot, "artifact-failed.json"), "utf-8"));
  assert.equal(orphanFailed.reason, "missing-run-record");
  assert.equal(await resumePendingPlanArtifactFinalizations(), 0);

  const recoveringRunRoot = path.join(runsRoot, "recovering-run");
  await mkdir(recoveringRunRoot, { recursive: true });
  const retainedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  await writeFile(path.join(recoveringRunRoot, "run-envelope.json"), JSON.stringify({
    version: "plan-run-envelope-v1",
    diagnosticId: "33333333-3333-4333-8333-333333333333",
    dataOwnerTag: null,
    result: {
      success: true,
      startedAt: retainedAt.toISOString(),
      runId: "33333333-3333-4333-8333-333333333333",
    },
  }), "utf-8");
  const recoveringEnvelopePath = path.join(recoveringRunRoot, "run-envelope.json");
  await utimes(recoveringEnvelopePath, retainedAt, retainedAt);
  const updateStatuses: string[] = [];
  assert.equal(await resumePendingPlanArtifactFinalizations({
    updateArtifact: async ({ status }) => {
      updateStatuses.push(status);
      return updateStatuses.length === 1 ? "unavailable" : "updated";
    },
    retryMs: [],
    slowRetryMs: 0,
  }), 1);
  assert.equal(await waitForPlanArtifactFinalizers(5_000), true);
  assert.deepEqual(updateStatuses, ["complete", "complete"]);
  assert.equal(
    JSON.parse(await readFile(path.join(recoveringRunRoot, "artifact-finalized.json"), "utf-8")).diagnosticId,
    "33333333-3333-4333-8333-333333333333",
  );
  await assert.rejects(
    readFile(path.join(recoveringRunRoot, "artifact-failed.json"), "utf-8"),
    (error: NodeJS.ErrnoException) => error.code === "ENOENT",
  );

  const expiredRunRoot = path.join(runsRoot, "retention-expired-run");
  await mkdir(expiredRunRoot, { recursive: true });
  const expiredEnvelopePath = path.join(expiredRunRoot, "run-envelope.json");
  const expiredDiagnosticId = "44444444-4444-4444-8444-444444444444";
  await writeFile(expiredEnvelopePath, JSON.stringify({
    version: "plan-run-envelope-v1",
    diagnosticId: expiredDiagnosticId,
    dataOwnerTag: null,
    result: {
      success: false,
      startedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
      runId: expiredDiagnosticId,
      error: "retention fixture",
    },
  }), "utf-8");
  const expiredAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
  await utimes(expiredEnvelopePath, expiredAt, expiredAt);
  assert.equal(await resumePendingPlanArtifactFinalizations({
    updateArtifact: async () => "unavailable",
    retryMs: [],
    slowRetryMs: 0,
  }), 1);
  assert.equal(await waitForPlanArtifactFinalizers(5_000), true);
  const retentionFailure = JSON.parse(await readFile(path.join(expiredRunRoot, "artifact-failed.json"), "utf-8"));
  assert.equal(retentionFailure.reason, "retention-exceeded");
});
