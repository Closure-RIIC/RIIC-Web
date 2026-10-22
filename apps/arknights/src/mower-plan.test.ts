import assert from "node:assert/strict";
import test from "node:test";

import { maaToMowerPlan, mowerPlanToMaa } from "./mower-plan.ts";

test("imports Mower plan.json into the existing MAA room groups", () => {
  const maa = mowerPlanToMaa({
    default: "plan1",
    plan1: {
      central: { name: "控制中枢", plans: [{ agent: "巫恋" }] },
      room_1_1: { name: "贸易站", product: "lmd", plans: [{ agent: "但书" }] },
      room_1_2: { name: "制造站", product: "exp", plans: [{ agent: "红" }] },
      room_1_3: { name: "发电站", plans: [] },
      factory: { name: "加工站", plans: [{ agent: "阿米娅" }] },
    },
  });

  assert.ok(maa);
  assert.deepEqual(maa.plans[0]?.rooms.control?.[0]?.operators, ["巫恋"]);
  assert.deepEqual(maa.plans[0]?.rooms.trading?.[0]?.operators, ["但书"]);
  assert.equal(maa.plans[0]?.rooms.trading?.[0]?.product, "LMD");
  assert.equal(maa.plans[0]?.rooms.manufacture?.[0]?.product, "Battle Record");
  assert.deepEqual(maa.plans[0]?.rooms.processing?.[0]?.operators, ["阿米娅"]);
});

test("exports the selected MAA shift as a Mower plan", () => {
  const mower = maaToMowerPlan({
    title: "test",
    plans: [{ name: "day", rooms: { trading: [{ operators: ["但书"], product: "LMD" }] } }],
  });

  assert.equal(mower.default, "plan1");
  assert.equal(mower.plan1.room_1_1?.name, "贸易站");
  assert.deepEqual(mower.plan1.room_1_1?.plans?.map((entry) => entry.agent), ["但书"]);
  assert.equal(mower.plan1.room_1_1?.product, "lmd");
});

test("uses Mower's native production product identifiers", () => {
  const mower = maaToMowerPlan({
    title: "test",
    plans: [{
      name: "day",
      rooms: {
        trading: [{ operators: [], product: "Originium Shard" }],
        manufacture: [
          { operators: [], product: "Battle Record" },
          { operators: [], product: "Originium Shard" },
        ],
      },
    }],
  });

  assert.equal(mower.plan1.room_1_1?.product, "orundum");
  assert.equal(mower.plan1.room_1_2?.product, "exp3");
  assert.equal(mower.plan1.room_1_3?.product, "orirock");
});

test("imports Mower orundum trading posts as the MAA product Orundum", () => {
  const maa = mowerPlanToMaa({
    default: "plan1",
    plan1: {
      room_1_1: { name: "贸易站", product: "orundum", plans: [] },
    },
  });

  assert.ok(maa);
  assert.equal(maa.plans[0]?.rooms.trading?.[0]?.product, "Orundum");
});
