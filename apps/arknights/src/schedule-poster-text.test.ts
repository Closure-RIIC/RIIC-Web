import "./i18n/test-setup.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyScheduleText, scheduleDraftToText } from "./schedule-poster-text.ts";
import { createManualScheduleDraft, manualScheduleToMaa, reconcileManualScheduleDraft } from "./manual-schedule.ts";
import { evaluateManualSchedule } from "./manual-schedule-evaluator.ts";
import type { BaseBlueprint, OperBoxEntry } from "@riic/arknights-domain/types";
const layout = JSON.parse(readFileSync(new URL("../../../packages/arknights-domain/src/layouts/252.json", import.meta.url), "utf8")) as BaseBlueprint;
const names = new Set(["能天使", "德克萨斯", "拉普兰德", "银灰", "杜宾", "菲亚梅塔"]);
const empty = () => reconcileManualScheduleDraft(createManualScheduleDraft([8, 8, 8]), layout);
test("bulk text applies teams, percentages, shift products, drone destinations and Fiammetta atomically", () => {
  const result = applyScheduleText("贸易站1：能天使、德克萨斯 @90% #龙门币 | = | 拉普兰德 @0% #合成玉\n训练室：_、杜宾 | = | =\n无人机：贸易站1 | 制造站1 | -\n菲亚梅塔：能天使 | 德克萨斯 | 拉普兰德", layout, empty(), names);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.draft.shifts[0]!.rooms.trade_1?.operators, ["能天使", "德克萨斯"]);
  assert.equal(result.draft.shifts[1]!.rooms.trade_1?.manualSkillEfficiencyPct, 90);
  assert.equal(result.draft.shifts[2]!.rooms.trade_1?.manualSkillEfficiencyPct, 0);
  assert.deepEqual(result.draft.shifts[2]!.rooms.trade_1?.product, {trade:{order:"originium"}});
  assert.deepEqual(result.draft.shifts[0]!.rooms.training_room?.operators, [null,"杜宾"]);
  assert.equal(result.draft.shifts[1]!.droneTargetRoomId, "manu_1");
  assert.equal(result.draft.fiammettaEnabled, true);
  assert.equal(result.draft.shifts[2]!.fiammettaTarget, "拉普兰德");
});
test("bulk trade assignments feed operator levels, manual efficiency and gold-order equivalence into evaluation", () => {
  const box: OperBoxEntry[] = [
    { id: "char_254_vodfox", name: "巫恋", elite: 2, level: 80, own: true, potential: 1, rarity: 5 },
    { id: "char_486_takila", name: "龙舌兰", elite: 2, level: 80, own: true, potential: 1, rarity: 5 },
    { id: "char_252_bibeak", name: "柏喙", elite: 2, level: 80, own: true, potential: 1, rarity: 5 },
  ];
  const draft = empty();
  const parsed = applyScheduleText("贸易站1：巫恋、龙舌兰、柏喙 @0% #龙门币 | - | -", layout, draft, new Set([...names, "巫恋", "龙舌兰", "柏喙"]));
  assert.deepEqual(parsed.errors, []);
  const evaluation = evaluateManualSchedule({ draft: parsed.draft, layout, operbox: box });
  const room = evaluation.roomsByShift[0]?.find(item => item.roomId === "trade_1");
  assert.ok(room);
  assert.equal(room.skillEfficiency, 0);
  assert.equal(room.specialTradeAnchor?.label, "巫恋 E2 + 龙舌兰 E2 + β裁缝");
  assert.equal(room.tradeEquivalentEfficiency, 0.26);
  assert.equal(room.goldEquivalentEfficiency, 0.252);
});
test("bulk patches preserve omitted facilities and allow moving an operator between changed rows", () => {
  const draft = empty();
  draft.shifts[0]!.rooms.trade_1 = { operators: ["能天使"] };
  draft.shifts[0]!.rooms.dorm_4 = { operators: ["银灰"], autofill: false };
  const result = applyScheduleText("贸易站1：- | - | -\n贸易站2：能天使 @45.5% | - | -", layout, draft, names);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.draft.shifts[0]!.rooms.dorm_4, draft.shifts[0]!.rooms.dorm_4);
  assert.deepEqual(draft.shifts[0]!.rooms.trade_1?.operators, ["能天使"]);
});
test("bulk text derives facility autofill from operator-level auto markers while dash stays manual", () => {
  const draft = empty();
  draft.shifts[0]!.rooms.dorm_1 = { operators: ["银灰"], autofill: false };
  const result = applyScheduleText(
    "宿舍1：银灰、auto | = | -\n宿舍2：德克萨斯 | Free | -",
    layout,
    draft,
    names,
  );
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.draft.shifts[0]!.rooms.dorm_1, { operators: ["银灰", null], autofill: true, autofillSlots: [1] });
  assert.deepEqual(result.draft.shifts[1]!.rooms.dorm_1, { operators: ["银灰", null], autofill: true, autofillSlots: [1] });
  assert.deepEqual(result.draft.shifts[2]!.rooms.dorm_1, { operators: [], autofill: false });
  assert.deepEqual(result.draft.shifts[0]!.rooms.dorm_2, { operators: ["德克萨斯"], autofill: false });
  assert.deepEqual(result.draft.shifts[1]!.rooms.dorm_2, { operators: [null], autofill: true, autofillSlots: [0] });
  assert.equal(result.draft.shifts[2]!.rooms.dorm_2?.autofill, false);
});

test("bulk text no longer accepts facility-level autofill directives", () => {
  for (const directive of ["@auto", "@manual", "@自动填充", "@手动填充"]) {
    const result = applyScheduleText(`宿舍1：银灰 ${directive} | - | -`, layout, empty(), names);
    assert.match(result.errors[0] ?? "", /无法识别设置/);
  }
});

test("bulk text round-trips operator-level autofill markers without facility directives", () => {
  const draft = empty();
  draft.shifts[0]!.rooms.dorm_1 = { operators: ["银灰", null], autofill: true, autofillSlots: [1] };
  draft.shifts[1]!.rooms.dorm_1 = { operators: ["德克萨斯"], autofill: false };
  const text = scheduleDraftToText(layout, draft);
  assert.match(text, /宿舍1：银灰、auto \| 德克萨斯 \| auto/);
  const result = applyScheduleText(text, layout, draft, names);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.draft.shifts.map(shift => shift.rooms.dorm_1?.autofillSlots), [[1], undefined, [0]]);
  assert.deepEqual(result.draft.shifts.map(shift => shift.rooms.dorm_1?.autofill), [true, false, true]);
});

test("bulk text exports the default empty marker as an operator-level auto", () => {
  const draft = empty();
  const before = structuredClone(draft);
  const text = scheduleDraftToText(layout, draft);
  assert.match(text, /中枢：auto \| auto \| auto/);
  assert.match(text, /宿舍1：auto \| auto \| auto/);
  assert.match(text, /训练室：- \| - \| -/);
  assert.doesNotMatch(text, /@(?:auto|manual)\b/);
  assert.deepEqual(draft, before);
  const result = applyScheduleText(text, layout, draft, names);
  assert.deepEqual(result.errors, []);
  assert.equal(result.draft.shifts[0]!.rooms.control?.autofill, true);
  assert.deepEqual(result.draft.shifts[0]!.rooms.control?.autofillSlots, [0]);
});

test("bulk text converts existing facility autofill to a slot marker and preserves explicit manual empties", () => {
  const draft = empty();
  draft.shifts[0]!.rooms.dorm_1 = { operators: ["银灰"], autofill: true };
  draft.shifts[1]!.rooms.dorm_1 = { operators: [], autofill: false };
  const text = scheduleDraftToText(layout, draft);
  assert.match(text, /宿舍1：银灰、auto \| - \| auto/);
  const result = applyScheduleText(text, layout, draft, names);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.draft.shifts[0]!.rooms.dorm_1, { operators: ["银灰", null], autofill: true, autofillSlots: [1] });
  assert.equal(result.draft.shifts[1]!.rooms.dorm_1?.autofill, false);
});
test("auto and Free retain individual slots and export fixed operators with facility autofill", () => {
  const result = applyScheduleText(
    "中枢：能天使、德克萨斯、拉普兰德、auto、Free | = | -",
    layout,
    empty(),
    names,
  );
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.draft.shifts[0]!.rooms.control?.operators, ["能天使", "德克萨斯", "拉普兰德", null, null]);
  assert.deepEqual(result.draft.shifts[0]!.rooms.control?.autofillSlots, [3, 4]);
  assert.equal(result.draft.shifts[0]!.rooms.control?.autofill, true);
  const maa = manualScheduleToMaa(result.draft, layout, false);
  assert.deepEqual(maa.plans[0]?.rooms.control?.[0], {
    operators: ["能天使", "德克萨斯", "拉普兰德"], sort: true, skip: false, autofill: true,
  });
  assert.deepEqual(maa.plans[2]?.rooms.control?.[0], {
    operators: [], sort: true, skip: false, autofill: false,
  });
  const text = scheduleDraftToText(layout, result.draft);
  assert.match(text, /中枢：能天使、德克萨斯、拉普兰德、auto、auto \|/);
  const roundTrip = applyScheduleText(text, layout, empty(), names);
  assert.deepEqual(roundTrip.errors, []);
  assert.deepEqual(roundTrip.draft.shifts[0]!.rooms.control?.autofillSlots, [3, 4]);
});
test("dash clears eligible facilities while named-only teams stay manual", () => {
  const draft = empty();
  for (const shift of draft.shifts) shift.rooms.control = { operators: [null], autofill: true, autofillSlots: [0] };
  const result = applyScheduleText(
    "中枢：- | _ | 能天使",
    layout,
    draft,
    names,
  );
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.draft.shifts.map(shift => shift.rooms.control?.autofill), [false, false, false]);
  assert.deepEqual(result.draft.shifts.map(shift => shift.rooms.control?.operators), [[], [null], ["能天使"]]);
  assert.deepEqual(result.draft.shifts.map(shift => shift.rooms.control?.autofillSlots), [undefined, undefined, undefined]);
  const maa = manualScheduleToMaa(result.draft, layout, false);
  assert.deepEqual(maa.plans.map(plan => plan.rooms.control?.[0]), [
    { operators: [], sort: true, skip: false, autofill: false },
    { operators: [], sort: true, skip: false, autofill: false },
    { operators: ["能天使"], sort: true, skip: false, autofill: false },
  ]);
});
test("overwriting a production team without an efficiency directive clears its prior manual override", () => {
  const draft = empty();
  draft.shifts[0]!.rooms.trade_1 = { operators: ["能天使"], manualSkillEfficiencyPct: 75 };
  const result = applyScheduleText("贸易站1：- | - | -", layout, draft, names);
  assert.deepEqual(result.errors, []);
  assert.equal(result.draft.shifts[0]!.rooms.trade_1?.manualSkillEfficiencyPct, undefined);
  assert.equal(result.draft.shifts[0]!.rooms.trade_1?.autofill, false);
});
test("invalid text never changes the draft and gives line-specific feedback", () => {
  const draft = empty();
  const cases = [
    "贸易站1：不存在 | - | -",
    "贸易站1：能天使 | -",
    "贸易站1：能天使 | - | -\n贸易站2：能天使 | - | -",
    "贸易站2：能天使、德克萨斯、拉普兰德 | - | -",
    "贸易站2：- #合成玉 | - | -",
    "训练室：杜宾 @90% | - | -",
    "无人机：宿舍1 | - | -",
    "菲亚梅塔：银灰 | - | -",
    "贸易站1：= | - | -",
    "贸易站1：- @10001% | - | -",
    "训练室：auto | - | -",
    "宿舍1：- @90% | - | -",
  ];
  for (const text of cases) {
    const result = applyScheduleText(text, layout, draft, names);
    assert.ok(result.errors.length, text);
    assert.strictEqual(result.draft, draft);
    assert.match(result.errors[0]!, /^第 /);
  }
});
test("generated templates retain positions, manual efficiency and dormant room data when edited", () => {
  for (const count of [1,2,3,4]) {
    const draft = reconcileManualScheduleDraft(createManualScheduleDraft(Array.from({length:count}, () => 24/count)),layout);
    draft.shifts[0]!.rooms.training_room = {operators:[null,"杜宾"]};
    draft.shifts[0]!.rooms.trade_1 = {operators:["能天使"],manualSkillEfficiencyPct:125.5, product:{trade:{order:"originium"}}};
    const text = scheduleDraftToText(layout,draft);
    const result = applyScheduleText(text,layout,draft,names);
    assert.deepEqual(result.errors,[]);
    assert.deepEqual(result.draft.shifts[0]!.rooms.training_room,draft.shifts[0]!.rooms.training_room);
    assert.deepEqual(result.draft.shifts[0]!.rooms.trade_1,{...draft.shifts[0]!.rooms.trade_1,autofill:false});
  }
});
