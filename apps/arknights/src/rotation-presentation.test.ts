import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPlanDuration,
  relativeMetricDelta,
  rotationMetricValue,
  rotationTeamLabel,
  shiftTabLabel,
  shiftTeamSummary,
} from "./rotation-presentation.ts";
import type { RotationShift } from "./types.ts";

const shift: RotationShift = {
  index: 0,
  duration_hours: 12,
  active_teams: ["alpha", "beta"],
  resting_team: "gamma",
  scores: { trade_score: 0, manu_prod_sum: 0, power_charge_sum: 0, room_lines: [] },
  weighted_trade: 0,
  weighted_manu: 0,
  weighted_power: 0,
};

test("shift labels and team summaries come from rotation output", () => {
  assert.equal(shiftTabLabel(shift, 0), "第 1 班 · 12h");
  assert.equal(shiftTeamSummary(shift, "abc_12_6_6"), "α+β 上班 · γ 休息");
  assert.equal(rotationTeamLabel("main_backup_12_12", "alpha"), "主力");
  assert.equal(rotationTeamLabel("abyssal_7_5_7_5", "beta"), "β");
});

test("manufacture and power multipliers become percentages", () => {
  assert.equal(rotationMetricValue("trade", 5.288), 5.288);
  assert.equal(rotationMetricValue("manu", 9.175).toFixed(1), "917.5");
  assert.equal(rotationMetricValue("power", 3.552).toFixed(1), "355.2");
});

test("relative comparison omits zero baselines", () => {
  assert.equal(relativeMetricDelta(5.288, 4.968)?.toFixed(1), "6.4");
  assert.equal(relativeMetricDelta(1, 0), undefined);
});

test("plan durations use milliseconds below one second and one decimal second otherwise", () => {
  assert.equal(formatPlanDuration(735), "735 ms");
  assert.equal(formatPlanDuration(999), "999 ms");
  assert.equal(formatPlanDuration(1000), "1.0 秒");
  assert.equal(formatPlanDuration(2764), "2.8 秒");
});
