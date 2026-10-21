import assert from "node:assert/strict";
import test from "node:test";

import type { PlanApiResponse, UserProfile } from "../types.ts";
import { PublicApiError } from "./api-contract.ts";
import { safeDisplayName, toPublicPlanData } from "./public-plan.ts";

function internalResult(): PlanApiResponse {
  return {
    success: true,
    durationMs: 42,
    runId: "diagnostic-1",
    cliPath: "C:\\secret\\infra-cli.exe",
    command: "infra-cli serve",
    stdout: "secret stdout",
    stderr: "secret stderr",
    profileJson: {
      schema_version: 4,
      rotation_profile: "abc_12_6_6",
      layout_label: "C:\\private\\243",
      operbox_label: "/private/box.json",
      baseline_label: "internal baseline",
      summary: { owned: 1, tier_up_owned: 1, trade_pool_ready: 1 },
      domains: [],
      rotation: {},
      baseline_rotation: {},
      actions: [],
      flags: [],
      narration_hints: [],
      nestedInternal: {
        cliPath: "C:\\secret\\future-cli.exe",
        debugBundle: { future: true },
        solver: { future: true },
        plan_contract_sha256: "a".repeat(64),
        solver_executable_sha256: "b".repeat(64),
      },
    } as UserProfile & { nestedInternal: Record<string, unknown> },
    maaJson: {
      title: "C:\\private\\title",
      planTimes: 2,
      plans: [{
        name: "班次 1",
        description_post: "换班后说明",
        period: [["08:00", "20:00"]],
        duration: 720,
        groups: [{ name: "贸易组", operators: ["龙舌兰", "但书"] }],
        Fiammetta: { enable: true, target: "但书", order: "pre" },
        drones: { enable: true, room: "manufacture", index: 1, rule: "all", order: "pre" },
        rooms: {
          trading: [{
            operators: ["龙舌兰"],
            sort: true,
            autofill: false,
            candidates: ["但书", "巫恋"],
            use_operator_groups: true,
          }],
          training: [{ operators: ["不应进入 MAA"] }],
        },
      }],
      scheduleType: { planTimes: 2, trading: 2, manufacture: 4, power: 3, dormitory: 4 },
      nestedInternal: {
        candidates: ["C:\\secret\\infra-cli.exe"],
        solver: { future: true },
        plan_contract_sha256: "a".repeat(64),
        solver_executable_sha256: "b".repeat(64),
      },
    } as unknown as PlanApiResponse["maaJson"] & { nestedInternal: Record<string, unknown> },
    trainingRoomJson: {
      schema_version: 1,
      shifts: [{ trainee: "能天使", trainer: "德克萨斯" }],
    },
    trainingAdviceJson: {
      schema_version: 2,
      context: { engineering_robot_count: 12, stdout: "secret" },
      newbie_section_status: "complete",
      incomplete_newbie: [],
      combinations: [],
      recommendations: [{
        operator: "泡泡",
        action: "acquire",
        target: { kind: "needs_review", command: "secret" },
        priority: "high_efficiency_standalone",
        priority_rank: 100,
        reason: "standalone",
        product: "originium_shards",
        conditions: [{
          condition: {
            kind: "custom",
            key: "safe",
            value: { visible: true, stdout: "secret", nested: { solver: "secret" } },
            description: "待核对条件",
          },
          status: "unknown",
          stderr: "secret",
        }],
        solver: { private: true },
      }],
      command: "secret",
      future_internal: "secret",
    } as unknown as PlanApiResponse["trainingAdviceJson"],
    rotationJson: {
      profile: "abc_12_6_6",
      shifts: [{
        index: 0,
        duration_hours: 12,
        active_teams: ["alpha", "beta"],
        resting_team: "gamma",
        scores: {
          trade_score: 2.1,
          manu_prod_sum: 420,
          power_charge_sum: 110,
          room_lines: [{ room_id: "trade_1", trade_score: 2.1, future_internal: "secret" }],
        },
        weighted_trade: 1.05,
        weighted_manu: 2.1,
        weighted_power: 0.55,
        assignment: { private: true },
        notes: ["private solver note"],
        efficiencies: { raw: true },
      }],
      daily: {
        trade: 4.2,
        manu: 8.4,
        power: 2.2,
        production: { lmd: 34_254, pure_gold: 53_000, battle_records: 22_400, originium_shards: 48, orundum: 360 },
      },
      future_internal: "secret",
    } as unknown as PlanApiResponse["rotationJson"],
    solver: {
      protocol_version: 1,
      plan_schema_version: 1,
      plan_contract_sha256: "a".repeat(64),
      solver_executable_sha256: "b".repeat(64),
      observed_at: "2026-08-13T00:00:00.000Z",
    },
    debugBundle: {
      version: "test",
      startedAt: "2026-07-28T00:00:00.000Z",
      durationMs: 42,
      cliPath: "C:\\secret\\infra-cli.exe",
      command: "infra-cli serve",
      exitCode: 0,
      signal: null,
      inputSummary: { layoutRooms: 1, operboxCount: 1, sourceName: "secret" },
      layout: { template: "243", drone_cap: 0, scenario: {}, rooms: [] },
      operbox: [],
      stdout: "secret",
      stderr: "",
      serveRequest: { method: "plan.compute" },
      serveResponse: { ok: true },
      solver: {
        protocol_version: 1,
        plan_schema_version: 1,
        plan_contract_sha256: "a".repeat(64),
        solver_executable_sha256: "b".repeat(64),
        observed_at: "2026-08-13T00:00:00.000Z",
      },
    },
  };
}

function keysDeep(value: unknown, result = new Set<string>()): Set<string> {
  if (!value || typeof value !== "object") return result;
  for (const [key, child] of Object.entries(value)) {
    result.add(key);
    keysDeep(child, result);
  }
  return result;
}

test("production public plan data recursively excludes internal fields", () => {
  const previous = process.env.BETA_DEBUG_TOOLS_ENABLED;
  delete process.env.BETA_DEBUG_TOOLS_ENABLED;
  try {
    const publicData = toPublicPlanData(
      internalResult(),
      { layoutLabel: "C:\\private\\243", sourceName: "/private/box.json" },
      "request"
    );
    const keys = keysDeep(publicData);
    for (const forbidden of [
      "cliPath",
      "command",
      "stdout",
      "stderr",
      "debugBundle",
      "serveRequest",
      "serveResponse",
      "runPath",
      "resultPath",
      "future_internal",
      "assignment",
      "notes",
      "efficiencies",
      "solver",
      "plan_contract_sha256",
      "solver_executable_sha256",
    ]) {
      assert.equal(keys.has(forbidden), false, `must not expose ${forbidden}`);
    }
    assert.equal(publicData.diagnosticId, "diagnostic-1");
    assert.equal(publicData.rotation.profile, "abc_12_6_6");
    assert.deepEqual(publicData.rotation.daily, {
      trade: 4.2,
      manufacture: 8.4,
      power: 2.2,
      production: { lmd: 34_254, pure_gold: 53_000, battle_records: 22_400, originium_shards: 48, orundum: 360 },
    });
    assert.equal(publicData.rotation.shifts[0].scores.room_lines[0].final_efficiency, 2.1);
    assert.equal(publicData.rotation.shifts[0].scores.room_lines[0].trade_score, 2.1);
    assert.equal(publicData.maa.planTimes, 2);
    assert.deepEqual(publicData.maa.plans[0].Fiammetta, { enable: true, target: "但书", order: "pre" });
    assert.equal(publicData.maa.plans[0].drones?.enable, true);
    assert.equal(publicData.maa.plans[0].drones?.rule, "all");
    assert.deepEqual(publicData.maa.plans[0].period, [["08:00", "20:00"]]);
    assert.equal(publicData.maa.plans[0].duration, 720);
    assert.equal(publicData.maa.plans[0].description_post, "换班后说明");
    assert.deepEqual(publicData.maa.plans[0].groups, [{ name: "贸易组", operators: ["龙舌兰", "但书"] }]);
    assert.equal(publicData.maa.plans[0].rooms.trading?.[0].sort, true);
    assert.deepEqual(publicData.maa.plans[0].rooms.trading?.[0].candidates, ["但书", "巫恋"]);
    assert.equal(publicData.maa.plans[0].rooms.trading?.[0].use_operator_groups, true);
    assert.equal("training" in publicData.maa.plans[0].rooms, false);
    assert.deepEqual(publicData.trainingRoom, {
      schema_version: 1,
      shifts: [{ trainee: "能天使", trainer: "德克萨斯" }],
    });
    assert.equal(
      "candidates" in (publicData.maa as typeof publicData.maa & { nestedInternal: Record<string, unknown> }).nestedInternal,
      false
    );
    assert.equal(publicData.maa.scheduleType?.planTimes, 2);
    assert.deepEqual(publicData.trainingAdvice, {
      schema_version: 2,
      context: { engineering_robot_count: 12 },
      newbie_section_status: "complete",
      incomplete_newbie: [],
      combinations: [],
      recommendations: [{
        operator: "泡泡",
        action: "acquire",
        target: { kind: "needs_review" },
        priority: "high_efficiency_standalone",
        priority_rank: 100,
        reason: "standalone",
        product: "originium_shards",
        conditions: [{
          condition: {
            kind: "custom",
            key: "safe",
            value: { visible: true, nested: {} },
            description: "待核对条件",
          },
          status: "unknown",
        }],
      }],
    });
    assert.equal(publicData.profile.baseline_label, "产品推荐基准");
    assert.equal(publicData.profile.layout_label.includes("\\"), false);
    assert.equal(publicData.maa.title.includes("\\"), false);
    assert.equal(keys.has("nestedInternal"), true);
  } finally {
    if (previous === undefined) delete process.env.BETA_DEBUG_TOOLS_ENABLED;
    else process.env.BETA_DEBUG_TOOLS_ENABLED = previous;
  }
});

test("debug fields require both the server switch and request opt-in", () => {
  const previousDeploymentEnvironment = process.env.APP_DEPLOYMENT_ENV;
  const previousDebugTools = process.env.BETA_DEBUG_TOOLS_ENABLED;
  process.env.APP_DEPLOYMENT_ENV = "development";
  process.env.BETA_DEBUG_TOOLS_ENABLED = "1";
  try {
    const ordinaryData = toPublicPlanData(
      internalResult(),
      { layoutLabel: "243", sourceName: "示例" },
      "request"
    );
    assert.equal(ordinaryData.debug, undefined);

    const data = toPublicPlanData(
      internalResult(),
      { layoutLabel: "243", sourceName: "示例" },
      "request",
      { includeDebug: true }
    );
    assert.equal(data.debug?.command, "infra-cli serve");
    assert.equal(data.debug?.stdout, "secret stdout");
    const keys = keysDeep(data.debug?.debugBundle);
    assert.equal(keys.has("solver"), false);
    assert.equal(keys.has("plan_contract_sha256"), false);
    assert.equal(keys.has("solver_executable_sha256"), false);

    process.env.BETA_DEBUG_TOOLS_ENABLED = "0";
    const disabledData = toPublicPlanData(
      internalResult(),
      { layoutLabel: "243", sourceName: "示例" },
      "request",
      { includeDebug: true }
    );
    assert.equal(disabledData.debug, undefined);
  } finally {
    if (previousDeploymentEnvironment === undefined) delete process.env.APP_DEPLOYMENT_ENV;
    else process.env.APP_DEPLOYMENT_ENV = previousDeploymentEnvironment;
    if (previousDebugTools === undefined) delete process.env.BETA_DEBUG_TOOLS_ENABLED;
    else process.env.BETA_DEBUG_TOOLS_ENABLED = previousDebugTools;
  }
});

test("safe display names remove path separators and control characters", () => {
  assert.equal(safeDisplayName(" C:\\private/\u0007name ", "fallback"), "C: private name");
});

test("public plan mapping rejects malformed optional training-room data", () => {
  const result = internalResult();
  result.trainingRoomJson = {
    schema_version: 1,
    shifts: [],
  };
  assert.throws(
    () => toPublicPlanData(result, { layoutLabel: "243", sourceName: "示例" }, "request"),
    (error: unknown) => error instanceof PublicApiError && error.code === "AIC-PLAN-3004",
  );
});
