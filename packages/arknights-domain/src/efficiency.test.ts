import assert from "node:assert/strict";
import test from "node:test";

import { normalizeServeRoomEfficiency, presentRoomEfficiency } from "./efficiency.ts";

test("normalizes backend total efficiency to the shared final_efficiency field", () => {
  assert.deepEqual(normalizeServeRoomEfficiency({
    room_id: "trade_1",
    trade_efficiency: 3.337,
    trade_skill_efficiency: 1.32,
  }), {
    room_id: "trade_1",
    final_efficiency: 3.337,
    trade_score: 3.337,
    trade_skill_pct: 132,
  });
  assert.equal(normalizeServeRoomEfficiency({
    room_id: "manu_1",
    final_efficiency: 2.5,
    manufacture_efficiency: 2.36,
  }).final_efficiency, 2.5);
});

test("trade formula uses base + equivalent + global and marks the equivalent multiplier", () => {
  const result = presentRoomEfficiency("trading", {
    base_efficiency: 1.03,
    equivalent_efficiency: 0.72,
    global_efficiency: 0.17,
    trade_equivalent_efficiency: 1.78,
  });
  assert.equal(result?.primaryValue, "192%");
  assert.deepEqual(result?.details, [
    { label: "", value: "103%", operator: "=" },
    { label: "技能效率", value: "72%", operator: "+" },
    { label: "跨设施", value: "17%", operator: "+", kind: "cross-station" },
    { label: "", value: "等效 178% 技能效率" },
  ]);
});

test("manufacture formula uses base + equivalent + global without a multiplier", () => {
  const result = presentRoomEfficiency("manufacture", {
    base_efficiency: 1.02,
    equivalent_efficiency: 1.3,
    global_efficiency: 0.06,
  });
  assert.equal(result?.primaryValue, "238%");
  assert.deepEqual(result?.details, [
    { label: "", value: "102%", operator: "=" },
    { label: "技能效率", value: "130%", operator: "+" },
    { label: "跨设施", value: "6%", operator: "+", kind: "cross-station" },
  ]);
});

test("manufacture formula still uses new fields when global is absent (zero skipped)", () => {
  const result = presentRoomEfficiency("manufacture", {
    base_efficiency: 1.02,
    equivalent_efficiency: 1.3,
  });
  assert.equal(result?.primaryValue, "232%");
  assert.deepEqual(result?.details, [
    { label: "", value: "102%", operator: "=" },
    { label: "技能效率", value: "130%", operator: "+" },
  ]);
});

test("manufacture formula puts the final result before proven additive terms", () => {
  const result = presentRoomEfficiency("manufacture", {
    manu_score: 236,
    manu_prod_skill: 130,
    manu_display_pct: 136,
  });

  assert.equal(result?.primaryValue, "236%");
  assert.equal(result?.primaryLabel, undefined);
  assert.deepEqual(result?.details, [
    { label: "", value: "100%", operator: "=" },
    { label: "纯技能", value: "130%", operator: "+" },
    { label: "跨设施", value: "6%", operator: "+", kind: "cross-station" },
  ]);
});

test("legacy manufacture bonus keeps an unsplit resident and global remainder", () => {
  const result = presentRoomEfficiency("manufacture", {
    manu_prod_total: 111,
    manu_prod_skill: 105,
  });
  assert.equal(result?.primaryValue, "211%");
  assert.deepEqual(result?.details.slice(0, 3), [
    { label: "", value: "100%", operator: "=" },
    { label: "纯技能", value: "105%", operator: "+" },
    { label: "综合加成", value: "6%", operator: "+" },
  ]);
});

test("trade formula combines resident and global efficiency and separates its mechanic multiplier", () => {
  const result = presentRoomEfficiency("trading", {
    final_efficiency: 3.337,
    trade_score: 3.337,
    trade_pct: 135,
    trade_skill_pct: 132,
    trade_gold_pct: 42,
  });
  assert.equal(result?.primaryValue, "333.7%");
  assert.deepEqual(result?.details, [
    { label: "", value: "100%", operator: "=" },
    { label: "综合加成", value: "135%", operator: "+" },
    { label: "订单机制", value: "1.42", operator: "×" },
  ]);
});
