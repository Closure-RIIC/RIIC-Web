import assert from "node:assert/strict";
import test from "node:test";

import { assertCompleteSolverOutput } from "./solver-output-contract.ts";

const timing = { topology: "auto" as const, shift_hours: [24, 24] as [number, number] };

function validAutoOutput() {
  return {
    profile: { schema_version: 4, domains: [{}], summary: { owned: 1 } },
    rotation: {
      profile: "main_backup_24_24",
      shifts: [0, 1].map(index => ({ index, duration_hours: 24 })),
      auto_rotation: {
        timing: { shift_hours: [24, 24] },
        complete: true,
        rooms: [{
          room_id: "trade_1", facility: "trade_post",
          main_missing_seats: 0, backup_missing_seats: 0,
          main_complete: true, backup_complete: true,
        }],
        constant_dorm_support: [["dorm_1", ["菲亚梅塔"]]],
      },
    },
    maa: {
      title: "自动轮换", description: "主备公共输出", planTimes: 2,
      plans: ["主力", "替补"].map(name => ({
        name, rooms: { trading: [{ operators: ["但书"] }] },
        Fiammetta: { enable: true, target: "但书", order: "pre" },
        drones: { enable: true, room: "trading", index: 1, order: "pre" },
      })),
    },
  };
}

test("automatic output accepts the shared main-backup shape and enabled support actions", () => {
  const output = validAutoOutput();
  assert.doesNotThrow(() => assertCompleteSolverOutput(output, timing));
  assert.doesNotThrow(() => assertCompleteSolverOutput(output, "auto"));
  output.rotation.auto_rotation.complete = false;
  output.rotation.auto_rotation.rooms[0]!.backup_missing_seats = 1;
  output.rotation.auto_rotation.rooms[0]!.backup_complete = false;
  assert.doesNotThrow(() => assertCompleteSolverOutput(output, timing));
});

const malformed: Array<[string, (output: ReturnType<typeof validAutoOutput>) => void]> = [
  ["missing metadata", output => { Reflect.deleteProperty(output.rotation, "auto_rotation"); }],
  ["wrong default profile", output => { output.rotation.profile = "generic_main_backup"; }],
  ["missing shift", output => { output.rotation.shifts.pop(); }],
  ["missing MAA plan", output => { output.maa.plans.pop(); }],
  ["metadata timing mismatch", output => { output.rotation.auto_rotation.timing.shift_hours = [32, 32]; }],
  ["shift timing mismatch", output => { output.rotation.shifts[1]!.duration_hours = 32; }],
  ["negative missing seats", output => { output.rotation.auto_rotation.rooms[0]!.main_missing_seats = -1; }],
  ["missing completeness", output => { Reflect.deleteProperty(output.rotation.auto_rotation, "complete"); }],
  ["missing dorm support", output => { Reflect.deleteProperty(output.rotation.auto_rotation, "constant_dorm_support"); }],
];

for (const [label, mutate] of malformed) {
  test(`automatic output rejects ${label}`, () => {
    const output = validAutoOutput();
    mutate(output);
    assert.throws(() => assertCompleteSolverOutput(output, timing), /Solver returned/);
  });
}

test("explicit non-default automatic timing retains its generic main-backup profile", () => {
  const output = validAutoOutput();
  output.rotation.profile = "generic_main_backup";
  output.rotation.auto_rotation.timing.shift_hours = [24, 12];
  output.rotation.shifts[1]!.duration_hours = 12;
  assert.doesNotThrow(() => assertCompleteSolverOutput(output, { topology: "auto", shift_hours: [24, 12] }));
  assert.throws(() => assertCompleteSolverOutput(output, timing), /Solver returned/);
});

test("ordinary main-backup requests do not require automatic metadata", () => {
  const output = validAutoOutput();
  Reflect.deleteProperty(output.rotation, "auto_rotation");
  assert.doesNotThrow(() => assertCompleteSolverOutput(output, "main_backup_24_24"));
});
