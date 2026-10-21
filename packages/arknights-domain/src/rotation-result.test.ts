import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRotationResult } from "./rotation-result.ts";

test("plan.compute rotation keeps the worker profile and daily summary while whitelisting shifts", () => {
  const rotation = normalizeRotationResult({
    source: {
      profile: "fiammetta_8_8_4_4",
      daily: {
        trade: 5.288,
        manufacture: 9.175,
        power: 3.552,
        production: { lmd: 34_254.5, pure_gold: 52_999, battle_records: 22_400, originium_shards: 48, orundum: 360 },
      },
      future_internal: "must not pass",
    },
    shifts: [{
      index: 3,
      duration_hours: 4,
      active_teams: ["alpha", "gamma", 7],
      resting_team: "beta",
      assignment: { rooms: ["private solver detail"] },
      notes: ["private solver note"],
      efficiencies: {
        trade_efficiency: 2.4,
        manufacture_efficiency: 5.5,
        power_efficiency: 1.2,
        room_lines: [{
          room_id: "manu_1",
          manufacture_efficiency: 1.55,
          manufacture_skill_efficiency: 0.95,
          manufacture_display_efficiency: 1.05,
          future_internal: 12,
        }],
      },
      weighted_trade: 0.4,
      weighted_manufacture: 0.917,
      weighted_power: 0.2,
    }],
    profile: {},
    fallbackProfile: "abc_12_6_6",
  });

  assert.equal(rotation.profile, "fiammetta_8_8_4_4");
  assert.deepEqual(rotation.daily, {
    trade: 5.288,
    manufacture: 9.175,
    power: 3.552,
    production: { lmd: 34_254.5, pure_gold: 52_999, battle_records: 22_400, originium_shards: 48, orundum: 360 },
  });
  assert.deepEqual(rotation.shifts[0], {
    index: 3,
    duration_hours: 4,
    active_teams: ["alpha", "gamma"],
    resting_team: "beta",
    scores: {
      trade_score: 2.4,
      manu_prod_sum: 550,
      power_charge_sum: 120,
      room_lines: [{
        room_id: "manu_1",
        final_efficiency: 1.55,
        manu_score: 155,
        manu_prod_skill: 95,
        manu_display_pct: 105,
      }],
    },
    weighted_trade: 0.4,
    weighted_manu: 0.917,
    weighted_power: 0.2,
  });
  assert.equal("efficiencies" in rotation.shifts[0], false);
  assert.equal("assignment" in rotation.shifts[0], false);
  assert.equal("notes" in rotation.shifts[0], false);
  assert.equal("future_internal" in rotation, false);
});

test("legacy rotation falls back through result and profile fields", () => {
  const rotation = normalizeRotationResult({
    source: {
      rotation: "main_backup_12_12",
      daily_trade_efficiency: 4.2,
      daily_manufacture_efficiency: 8.4,
      daily_power_efficiency: 3.1,
      shifts: [{
        scores: {
          trade_score: 1.8,
          manu_prod_sum: 420,
          power_charge_sum: 110,
          room_lines: [{ room_id: "trade_1", final_efficiency: 1.8, trade_score: 1.8, trade_skill_pct: 80 }],
        },
      }, { scores: {} }],
    },
    profile: { rotation_profile: "abc_12_6_6", rotation: {} },
    fallbackProfile: "abyssal_7_5_7_5",
  });

  assert.equal(rotation.profile, "main_backup_12_12");
  assert.deepEqual(rotation.daily, { trade: 4.2, manufacture: 8.4, power: 3.1 });
  assert.equal(rotation.shifts[0].duration_hours, 12);
  assert.equal(rotation.shifts[1].duration_hours, 12);
  assert.deepEqual(rotation.shifts[0].scores.room_lines[0], {
    room_id: "trade_1",
    final_efficiency: 1.8,
    trade_score: 1.8,
    trade_skill_pct: 80,
  });
});

test("legacy room totals migrate to final_efficiency at the protocol boundary", () => {
  const rotation = normalizeRotationResult({
    source: {
      rotation: "main_backup_12_12",
      shifts: [{
        scores: {
          room_lines: [
            { room_id: "trade_1", trade_pct: 120 },
            { room_id: "manu_1", manu_prod_total: 145 },
            { room_id: "power_1", power_charge_speed_pct: 20 },
          ],
        },
      }],
    },
    profile: {},
    fallbackProfile: "abc_12_6_6",
  });

  assert.deepEqual(
    rotation.shifts[0].scores.room_lines.map((line) => line.final_efficiency),
    [2.2, 2.45, 1.2]
  );
});

test("worker gold-equivalent efficiency is retained in the public room-line allowlist", () => {
  const rotation = normalizeRotationResult({
    source: {
      shifts: [{
        scores: {
          room_lines: [{
            room_id: "trade_1",
            total_efficiency: 1.9,
            order_multiplier: 1.5,
            gold_equivalent_efficiency: 0.368,
          }],
        },
      }],
    },
    fallbackProfile: "abc_12_6_6",
  });
  assert.equal(rotation.shifts[0]?.scores.room_lines[0]?.gold_equivalent_efficiency, 0.368);
});

test("missing summaries use the profile snapshot and requested profile", () => {
  const rotation = normalizeRotationResult({
    source: {},
    shifts: [],
    profile: {
      rotation: {
        daily_trade_efficiency: 3,
        daily_manufacture_efficiency: 6,
        daily_power_efficiency: 2,
      },
    },
    fallbackProfile: "abyssal_7_5_7_5",
  });

  assert.equal(rotation.profile, "abyssal_7_5_7_5");
  assert.deepEqual(rotation.daily, { trade: 3, manufacture: 6, power: 2 });
});

test("partial, negative, or non-finite solver production is omitted instead of becoming zero", () => {
  for (const production of [
    { lmd: 1, pure_gold: 2, battle_records: 3, originium_shards: 4 },
    { lmd: -1, pure_gold: 2, battle_records: 3, originium_shards: 4, orundum: 5 },
    { lmd: 1, pure_gold: 2, battle_records: Number.NaN, originium_shards: 4, orundum: 5 },
  ]) {
    const rotation = normalizeRotationResult({
      source: { daily: { trade: 1, manufacture: 2, power: 3, production } },
      fallbackProfile: "abc_12_6_6",
    });
    assert.equal(rotation.daily.production, undefined);
  }
});
