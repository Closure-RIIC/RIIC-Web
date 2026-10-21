import assert from "node:assert/strict";
import test from "node:test";

import { prepareMaaForExport } from "./maa-safety.ts";
import type { MaaJson } from "./types.ts";

test("MAA export fixes every action to pre without changing source data", () => {
  const maa: MaaJson = {
    title: "execution",
    plans: [0, 1].map(() => ({
      name: "Shift",
      rooms: {},
      Fiammetta: { enable: true, target: "但书", order: "post" },
      drones: { enable: true, room: "trading", index: 1, rule: "all", order: "post" },
    })),
  };
  const exported = prepareMaaForExport(maa);
  for (const plan of exported.plans) {
    assert.equal(plan.Fiammetta?.order, "pre");
    assert.equal(plan.drones?.order, "pre");
  }
  assert.equal(maa.plans[0]!.Fiammetta!.order, "post");
  assert.equal(maa.plans[0]!.drones!.order, "post");
});

test("prepares MAA export with sort enabled and preserves displayed operator order", () => {
  const maa: MaaJson = {
    title: "test",
    plans: [{
      name: "班次 1",
      rooms: {
        trading: [{
          operators: ["古米", "银灰", "梅"],
          sort: false,
        }],
      },
    }],
  };

  const exported = prepareMaaForExport(maa);
  const room = exported.plans[0]!.rooms.trading![0]!;

  assert.equal(room.sort, true);
  assert.deepEqual(room.operators, ["古米", "银灰", "梅"]);
  assert.equal(maa.plans[0]!.rooms.trading![0]!.sort, false);

  const relaxed = prepareMaaForExport(maa, false);
  assert.equal(relaxed.plans[0]!.rooms.trading![0]!.sort, false);

  const replacementSorted = prepareMaaForExport(maa, false, true);
  assert.equal(replacementSorted.plans[0]!.rooms.trading![0]!.sort, true);
});

test("downloads normalize every dorm to skip=false and autofill=true", () => {
  const maa: MaaJson = {
    title: "计算排班",
    plans: [false, undefined].map((autofill, index) => ({
      name: `班次 ${index + 1}`,
      rooms: {
        dormitory: [
          { operators: [], autofill },
          { operators: ["阿米娅", null, { name: "杜林" }, " ", {}], autofill },
          { operators: ["阿米娅", "杜林", "芬", "克洛丝", "米格鲁"], autofill },
          { operators: ["芬", "克洛丝"], autofill },
          { operators: [], autofill, skip: true },
          { operators: ["阿米娅", "杜林", "芬", "克洛丝", "米格鲁"], autofill: true },
          { operators: ["杜林"], autofill, candidates: ["芬"] },
        ],
        trading: [{ operators: ["但书"], autofill: false }],
        meeting: [{ operators: [], autofill: true }],
      },
    })),
  };
  const original = structuredClone(maa);
  const exported = JSON.parse(JSON.stringify(prepareMaaForExport(maa, true, false))) as MaaJson;

  exported.plans.forEach((plan, index) => {
    assert.deepEqual(
      plan.rooms.dormitory?.map((room) => room.autofill),
      [true, true, true, true, true, true, true],
    );
    assert.deepEqual(
      plan.rooms.dormitory?.map((room) => room.skip),
      [false, false, false, false, false, false, false],
    );
    assert.deepEqual(
      plan.rooms.dormitory?.map((room) => room.candidates ?? null),
      [null, null, null, null, null, null, null],
    );
    assert.deepEqual(plan.rooms.dormitory?.map((room) => room.operators), maa.plans[index]!.rooms.dormitory?.map((room) => room.operators));
    assert.equal(plan.rooms.trading?.[0]?.autofill, false);
    assert.equal(plan.rooms.trading?.[0]?.skip, undefined);
    assert.equal(plan.rooms.meeting?.[0]?.autofill, true);
  });
  assert.deepEqual(maa, original);
});

test("manual downloads also normalize every dorm to skip=false and autofill=true", () => {
  const maa: MaaJson = {
    title: "手动排班",
    plans: [{
      name: "班次 1",
      rooms: {
        dormitory: [
          { operators: [], autofill: false },
          { operators: ["杜林"], autofill: false },
          { operators: [], autofill: true },
        ],
      },
    }],
  };
  const dorms = prepareMaaForExport(maa).plans[0]!.rooms.dormitory!;
  assert.deepEqual(dorms.map((room) => room.autofill), [true, true, true]);
  assert.deepEqual(dorms.map((room) => room.skip), [false, false, false]);
});
