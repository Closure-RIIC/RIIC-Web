import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { BaseBlueprint, OperBoxEntry } from "@riic/arknights-domain/types";
import {
  AutoRotationCliError,
  projectAutoRotationReport,
  runAutoRotationCli,
  withAutoRotationLane,
} from "./auto-rotation.ts";
import { withSolverLane } from "./solver-fallback.ts";

const report = {
  mode: "auto_rotation",
  timing: { shift_hours: [24, 12] },
  complete: false,
  rooms: [
    {
      room_id: "trade_1",
      facility: "trade_post",
      main: {
        operators: [{ name: "阿米娅" }],
        efficiency: { trade_total_efficiency: 1.75 },
        power_charge_efficiency: null,
        support_speed_bonus_pct: null,
        recycle_efficiency: null,
        evaluation_hours: 24,
        first_red_face: "阿米娅",
        missing_seats: 2,
        complete: false,
      },
      backup: {
        operators: [{ name: "能天使" }, { name: "德克萨斯" }, { name: "拉普兰德" }],
        efficiency: { trade_total_efficiency: 2.05 },
        evaluation_hours: 12,
        first_red_face: null,
        missing_seats: 0,
        complete: true,
      },
    },
    {
      room_id: "recycling_station",
      facility: "recycle",
      main: {
        operators: [{ name: "红云" }, { name: "稀音" }],
        recycle_efficiency: { operator_count: 2, base_efficiency: 0.82, operator_efficiency: 0.3, total_efficiency: 1.12 },
        evaluation_hours: 24,
        first_red_face: null,
        missing_seats: 0,
        complete: true,
      },
      backup: {
        operators: [{ name: "清流" }, { name: "温蒂" }],
        recycle_efficiency: { operator_count: 2, base_efficiency: 0.82, operator_efficiency: 0.2, total_efficiency: 1.02 },
        evaluation_hours: 12,
        first_red_face: null,
        missing_seats: 0,
        complete: true,
      },
    },
  ],
  constant_dorm_support: [["dorm_1", [{ name: "夕" }]]],
  fiammetta: {
    enabled: true,
    available: true,
    targets: [{ target: "巫恋", room_id: "trade_1", state: "continuous" }],
  },
  warnings: ["C:\\private\\solver\\layout.json must not leak", "trade_1 主力缺2人"],
};

test("automatic rotation projection exposes only the public camelCase DTO and solver units", () => {
  const result = projectAutoRotationReport(report, [24, 12], 12.6, "diagnostic-id");
  assert.equal(result.mode, "auto");
  assert.deepEqual(result.hours, [24, 12]);
  assert.equal(result.complete, false);
  assert.equal(result.durationMs, 13);
  assert.equal(result.rooms[0]?.main.productionEfficiency, 1.75);
  assert.equal(result.rooms[1]?.main.recycleEfficiency, 1.12);
  assert.deepEqual(result.dormSupport, [{ roomId: "dorm_1", operators: ["夕"] }]);
  assert.deepEqual(result.fiammetta, {
    enabled: true,
    available: true,
    targets: [{ target: "巫恋", roomId: "trade_1" }],
  });
  assert.equal(result.warnings[0]?.includes("C:\\private"), false);
  assert.equal("main_assignment" in result, false);
  assert.equal("assignment_plans" in result, false);
});

test("automatic rotation projection rejects inconsistent completion and timing", () => {
  assert.throws(
    () => projectAutoRotationReport({ ...report, complete: true }, [24, 12], 1, "id"),
    (error) => error instanceof AutoRotationCliError && error.reason === "invalid_output",
  );
  assert.throws(
    () => projectAutoRotationReport(report, [12, 12], 1, "id"),
    (error) => error instanceof AutoRotationCliError && error.reason === "invalid_output",
  );
});

test("projects evaluated trade formulas, order multipliers and raw daily units through a whitelist", () => {
  const raw = structuredClone(report);
  raw.rooms[0].main.efficiency = {
    trade_base_efficiency: 1.03, trade_paper_efficiency: 1.9,
    trade_occupancy_efficiency: 0.03, trade_control_efficiency: 0.07,
    trade_total_efficiency: 1.9, trade_unit_output_multiplier: 1.8,
    trade_skill_efficiency: 0.8, trade_equivalent_trade_efficiency: 1.85,
    trade_equivalent_gold_efficiency: 0.3, trade_output_per_day: 35_106.3,
    private_solver_data: "hidden",
  } as typeof raw.rooms[0]["main"]["efficiency"];
  const state = projectAutoRotationReport(raw, [24, 12], 1, "id").rooms[0].main;
  assert.equal(state.productionPerDay, 35_106.3);
  assert.ok(Math.abs(state.productionEfficiency! - 3.42) < 1e-9);
  assert.equal(state.efficiency?.base_efficiency, 1.03);
  assert.ok(Math.abs(state.efficiency!.equivalent_efficiency! - 0.8) < 1e-9);
  assert.equal(state.efficiency?.global_efficiency, 0.07);
  assert.equal(state.efficiency?.total_efficiency, 1.9);
  assert.equal(state.efficiency?.order_multiplier, 1.8);
  assert.equal(state.efficiency?.trade_equivalent_efficiency, 1.85);
  assert.equal(state.efficiency?.gold_equivalent_efficiency, 0.3);
  assert.ok(Math.abs(state.efficiency!.gold_output_multiplier! - 0.3 / 1.9) < 1e-9);
  assert.equal(JSON.stringify(state).includes("private_solver_data"), false);
  assert.equal(projectAutoRotationReport(report, [24, 12], 1, "id").rooms[0].main.efficiency?.trade_skill_pct, undefined);
});

test("projects factory output in value units and rejects nonfinite evaluated fields", () => {
  const raw = structuredClone(report);
  const factory = { ...raw.rooms[0], facility: "factory", main: { ...raw.rooms[0].main, efficiency: {
    manufacture_base_efficiency: 1.03, manufacture_global_efficiency: 0.02,
    manufacture_skill_efficiency: 1.05, manufacture_total_efficiency: 2.1,
    manufacture_output_per_day: 16_800, manufacture_storage_limit: 54,
  } }, backup: { ...raw.rooms[0].backup, efficiency: {} } };
  const state = projectAutoRotationReport({ ...raw, rooms: [factory, raw.rooms[1]] }, [24, 12], 1, "id").rooms[0].main;
  assert.equal(state.productionPerDay, 16_800);
  assert.equal(state.efficiency?.manu_storage_limit, 54);
  assert.equal(state.efficiency?.final_efficiency, 2.1);
  for (const invalid of [NaN, Infinity, -Infinity]) {
    assert.throws(() => projectAutoRotationReport({ ...raw, rooms: [{ ...factory, main: { ...factory.main, efficiency: { manufacture_output_per_day: invalid } } }, raw.rooms[1]] }, [24, 12], 1, "id"), AutoRotationCliError);
  }
});

test("automatic rotation runner uses fixed CLI arguments and parses stdout JSON", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "riic-auto-test-"));
  try {
    const script = path.join(root, "fake-cli.mjs");
    const completeReport = {
      ...report,
      complete: true,
      rooms: report.rooms.map((room) => ({
        ...room,
        main: { ...room.main, missing_seats: 0, complete: true },
      })),
      warnings: [],
    };
    await writeFile(script, `
      import { readFileSync } from "node:fs";
      const args = process.argv.slice(2);
      const required = ["plan", "--layout", "--operbox", "--rotation", "auto@24/12", "--json", "--assert-invariants", "--no-fiammetta"];
      for (const value of required) if (!args.includes(value)) process.exit(31);
      const layoutPath = args[args.indexOf("--layout") + 1];
      const operboxPath = args[args.indexOf("--operbox") + 1];
      JSON.parse(readFileSync(layoutPath, "utf8"));
      JSON.parse(readFileSync(operboxPath, "utf8"));
      process.stdout.write(${JSON.stringify(JSON.stringify(completeReport))});
    `, "utf8");
    const result = await runAutoRotationCli(
      {
        layout: { template: "test", drone_cap: 0, scenario: {}, rooms: [] } as BaseBlueprint,
        operbox: [{ id: "char_002_amiya", name: "阿米娅", own: true, elite: 2, level: 80, potential: 1, rarity: 5 }] as OperBoxEntry[],
        hours: [24, 12],
        fiammettaEnable: false,
      },
      {
        cliPath: process.execPath,
        runtimeDataDir: null,
        timeoutMs: 5_000,
        commandPrefix: [script],
      },
    );
    assert.equal(result.complete, true);
    assert.match(result.diagnosticId, /^[0-9a-f-]{36}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("automatic rotation runner reports timeout without exposing process diagnostics", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "riic-auto-timeout-"));
  try {
    const script = path.join(root, "slow-cli.mjs");
    await writeFile(script, "setInterval(() => {}, 1000);", "utf8");
    await assert.rejects(
      runAutoRotationCli(
        {
          layout: { template: "test", drone_cap: 0, scenario: {}, rooms: [] } as BaseBlueprint,
          operbox: [{ id: "char_002_amiya", name: "阿米娅", own: true, elite: 2, level: 80, potential: 1, rarity: 5 }] as OperBoxEntry[],
          hours: [24, 12],
        },
        {
          cliPath: process.execPath,
          runtimeDataDir: null,
          timeoutMs: 30,
          commandPrefix: [script],
        },
      ),
      (error) => error instanceof AutoRotationCliError
        && error.reason === "timeout"
        && error.message === "Automatic rotation solver timed out.",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("automatic rotation rejects incomplete custom runtime data instead of silently replacing it", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "riic-auto-custom-data-"));
  try {
    await assert.rejects(
      runAutoRotationCli(
        {
          layout: { template: "test", drone_cap: 0, scenario: {}, rooms: [] } as BaseBlueprint,
          operbox: [{ id: "char_002_amiya", name: "Amiya", own: true, elite: 2, level: 80, potential: 1, rarity: 5 }] as OperBoxEntry[],
          hours: [24, 12],
        },
        {
          cliPath: process.execPath,
          runtimeDataDir: root,
          timeoutMs: 1_000,
        },
      ),
      (error) => error instanceof AutoRotationCliError && error.reason === "runtime_unavailable",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("automatic rotation cancellation while queued returns immediately and preserves lane order", async () => {
  let releaseBlocker!: () => void;
  let blockerStarted!: () => void;
  const started = new Promise<void>((resolve) => { blockerStarted = resolve; });
  const blocked = new Promise<void>((resolve) => { releaseBlocker = resolve; });
  const blocker = withSolverLane(71, async () => {
    blockerStarted();
    await blocked;
  });
  await started;

  const controller = new AbortController();
  let queuedRuns = 0;
  const queued = withAutoRotationLane(71, controller.signal, 5_000, async () => {
    queuedRuns += 1;
  });
  controller.abort();
  await assert.rejects(
    queued,
    (error) => error instanceof AutoRotationCliError && error.reason === "aborted",
  );
  assert.equal(queuedRuns, 0);

  releaseBlocker();
  await blocker;
  await delay(0);
  assert.equal(queuedRuns, 0);
  assert.equal(await withAutoRotationLane(71, undefined, 1_000, async () => "next"), "next");
});

test("automatic rotation lane waiting consumes the total execution deadline", async () => {
  let releaseBlocker!: () => void;
  let blockerStarted!: () => void;
  const started = new Promise<void>((resolve) => { blockerStarted = resolve; });
  const blocked = new Promise<void>((resolve) => { releaseBlocker = resolve; });
  const blocker = withSolverLane(72, async () => {
    blockerStarted();
    await blocked;
  });
  await started;

  let solverRuns = 0;
  const keepEventLoopAlive = delay(100);
  await assert.rejects(
    withAutoRotationLane(72, undefined, 30, async () => {
      solverRuns += 1;
    }),
    (error) => error instanceof AutoRotationCliError && error.reason === "timeout",
  );
  await keepEventLoopAlive;
  assert.equal(solverRuns, 0);
  releaseBlocker();
  await blocker;
  await delay(0);
  assert.equal(solverRuns, 0);
});
