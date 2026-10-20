import assert from "node:assert/strict";
import test from "node:test";

import { resolveManualSpecialTradeOutput } from "./manual-trade-special-rules.ts";

test("special trade anchors expose docus, closure, and witch-tequila output assumptions", () => {
  const docus = resolveManualSpecialTradeOutput({
    level: 3,
    order: "gold",
    members: [{ id: "char_4032_provs", name: "但书", elite: 2 }],
  });
  assert.equal(docus.rule?.regularTradeOutputPerDay, 10_265);
  assert.equal(docus.rule?.tradeUnitOutputPerDay, 15_929.2);
  assert.equal(docus.orderMultiplier, 1.552);

  const closure = resolveManualSpecialTradeOutput({
    level: 3,
    order: "gold",
    members: [{ id: "char_4228_closur", name: "可露希尔", elite: 2 }],
  });
  assert.equal(closure.rule?.tradeUnitOutputPerDay, 12_000);
  assert.equal(closure.goldUnitOutputPerDay, 2_000);
  assert.equal(closure.orderMultiplier, 1.169);

  const witchTequila = resolveManualSpecialTradeOutput({
    level: 3,
    order: "gold",
    members: [
      { id: "char_254_vodfox", name: "巫恋", elite: 2 },
      { id: "char_486_takila", name: "龙舌兰", elite: 2 },
      { id: "char_252_bibeak", name: "柏喙", elite: 2 },
    ],
  });
  assert.equal(witchTequila.rule?.tradeUnitOutputPerDay, 12_739.73);
  assert.equal(witchTequila.goldUnitOutputPerDay, 2_328.77);
  assert.equal(witchTequila.orderMultiplier, 1.241);
});

test("special trade anchors only apply to gold orders and respect rule precedence", () => {
  const originium = resolveManualSpecialTradeOutput({
    level: 3,
    order: "originium",
    members: [{ name: "但书", elite: 2 }],
  });
  assert.equal(originium.orderMultiplier, 1);
  assert.equal(originium.rule, undefined);

  const precedence = resolveManualSpecialTradeOutput({
    level: 3,
    order: "gold",
    members: [
      { name: "但书", elite: 2 },
      { name: "可露希尔", elite: 2 },
      { name: "巫恋", elite: 2 },
      { name: "龙舌兰", elite: 2 },
    ],
  });
  assert.equal(precedence.rule?.label, "但书 E2 特殊订单");
});
