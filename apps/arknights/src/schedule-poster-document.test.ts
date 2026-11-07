import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPosterDocument, readPosterFile, posterDataOnly, posterDraftForManual } from "./schedule-poster-document.ts";
import { assignManualOperator, createManualScheduleDraft, createManualScheduleDraftFromCalculator, manualScheduleToMaa, reconcileManualScheduleDraft, loadManualScheduleDraft } from "./manual-schedule.ts";
import type { BaseBlueprint } from "@riic/arknights-domain/types";
import { defaultPosterOperator, posterOperators } from "./schedule-poster-operators.ts";
import { OPERATOR_CATALOG } from "./operatorPortraits.ts";

const layout = JSON.parse(readFileSync(new URL("../../../packages/arknights-domain/src/layouts/252.json", import.meta.url), "utf8")) as BaseBlueprint;
test("editable work file preserves shift products, efficiency, training roles and dormant facilities", () => {
  const draft = createManualScheduleDraft([8, 8, 8]);
  draft.shifts[0]!.rooms.trade_1 = {
    operators: ["巫恋", null, "龙舌兰"],
    autofill: true,
    autofillSlots: [1],
    manualSkillEfficiencyPct: 125,
  };
  draft.shifts[1]!.rooms.trade_1 = { operators: ["能天使"], product: { trade: { order: "originium" } }, manualSkillEfficiencyPct: 100 };
  draft.shifts[0]!.rooms.training_room = { operators: ["银灰", "杜宾"] };
  draft.shifts[0]!.rooms.dorm_4 = { operators: ["德克萨斯"], autofill: false };
  const document = createPosterDocument(layout, draft);
  const decoded = readPosterFile(JSON.stringify(posterDataOnly(document)));
  assert.deepEqual(decoded.draft, draft);
  const manual = posterDraftForManual(decoded);
  assert.deepEqual(manual.shifts[0]!.rooms.training_room?.operators, ["银灰", "杜宾"]);
  assert.equal(manual.shifts[0]!.rooms.dorm_4?.operators[0], "德克萨斯");
  assert.equal(manual.shifts[0]!.rooms.trade_1?.manualSkillEfficiencyPct, 125);
  assert.deepEqual(manual.shifts[0]!.rooms.trade_1?.autofillSlots, [1]);
  assert.deepEqual(manual.shifts[1]!.rooms.trade_1?.product, { trade: { order: "originium" } });
  const edited = assignManualOperator({ draft: manual, layout, shiftIndex: 0, roomId: "trade_1", slotIndex: 1, operator: "但书" }).draft;
  assert.equal(edited.shifts[0]!.rooms.trade_1?.operators[1], "但书");
  assert.deepEqual(edited.shifts[1], manual.shifts[1]);
  const persisted = loadManualScheduleDraft({ getItem: () => JSON.stringify(edited), setItem: () => {} });
  assert.deepEqual(persisted?.shifts[1]!.rooms.trade_1?.product, draft.shifts[1]!.rooms.trade_1?.product);
});
test("downloaded schedule files retain the complete Box and exact training, including unassigned and unowned operators", () => {
  const draft = createManualScheduleDraft([24]);
  draft.shifts[0]!.rooms.trade_1 = { operators: ["阿米娅", "巫恋", null] };
  const training = [
    { id: "char_002_amiya", name: "阿米娅", elite: 2, level: 73, own: true, potential: 4, rarity: 5 },
    { id: "char_254_vodfox", name: "巫恋", elite: 1, level: 42, own: true, potential: 2, rarity: 5 },
    { id: "char_348_ceylon", name: "锡兰", elite: 1, level: 26, own: false, potential: 1, rarity: 5 },
  ];
  const downloaded = readPosterFile(JSON.stringify(posterDataOnly(createPosterDocument(layout, draft, training))));
  assert.deepEqual(downloaded.operators, training);
  assert.deepEqual(posterOperators(downloaded), training);
  downloaded.operators[0]!.level = 1;
  assert.equal(training[0]!.level, 73);
  assert.equal(training.length, 3);
});

test("a complete catalog Box survives creation, inheritance, clearing assignments and file round trips", () => {
  const box = OPERATOR_CATALOG.map(operator => ({ ...defaultPosterOperator(operator.name)!, own: operator.rarity > 2 }));
  assert.ok(box.length > 200);
  const draft = createManualScheduleDraft([24]);
  draft.shifts[0]!.rooms.trade_1 = { operators: ["阿米娅", null, null] };
  const original = structuredClone(box);
  const created = createPosterDocument(layout, draft, box);
  assert.deepEqual(created.operators, box);
  const inherited = readPosterFile(JSON.stringify(posterDataOnly(created)));
  inherited.operators = posterOperators(inherited);
  inherited.draft = createManualScheduleDraft([24]);
  const exported = readPosterFile(JSON.stringify(posterDataOnly(inherited)));
  assert.deepEqual(exported.operators, original);
  assert.deepEqual(box, original);
});

test("complete Boxes retain unowned MAA progression placeholders while owned progression stays validated", () => {
  const owned = defaultPosterOperator("阿米娅")!;
  const placeholder = { ...defaultPosterOperator("锡兰")!, own: false, elite: -1, level: 0, potential: 0 };
  const doc = createPosterDocument(layout, createManualScheduleDraft([24]), [owned, placeholder]);
  const restored = readPosterFile(JSON.stringify(posterDataOnly(doc)));
  assert.deepEqual(posterOperators(restored), [owned, placeholder]);
  const invalid = structuredClone(doc);
  invalid.operators[1]!.own = true;
  assert.throws(() => readPosterFile(JSON.stringify(invalid)), /operators/);
});

test("switching a copied schedule to a new Box keeps its assignments and uses new training before author references", () => {
  const draft = createManualScheduleDraft([24]);
  draft.shifts[0]!.rooms.trade_1 = { operators: ["阿米娅", "巫恋", null] };
  const author = [
    { ...defaultPosterOperator("阿米娅")!, elite: 1, level: 42, potential: 2 },
    { ...defaultPosterOperator("巫恋")!, elite: 1, level: 36 },
    defaultPosterOperator("银灰")!,
  ];
  const personal = [{ ...author[0]!, elite: 2, level: 73, potential: 4 }, defaultPosterOperator("锡兰")!];
  const document = createPosterDocument(layout, draft, personal);
  const currentBox = posterOperators(document, author);
  assert.deepEqual(currentBox, [...personal, { ...author[1]!, own: false }]);
  assert.deepEqual(document.draft, draft);
  assert.deepEqual(document.operators, personal);
  assert.equal(currentBox.some(operator => operator.name === "银灰"), false);
  const restored = readPosterFile(JSON.stringify(posterDataOnly({ ...document, operators: currentBox })));
  assert.deepEqual(posterOperators(restored), currentBox);
  assert.deepEqual(posterDraftForManual(restored).shifts[0]!.rooms.trade_1?.operators, ["阿米娅", "巫恋", null]);
});

test("switching Box and restoring keeps a Fiammetta target that is not assigned to a room", () => {
  const draft = createManualScheduleDraft([24]);
  draft.shifts[0]!.rooms.trade_1 = { operators: ["阿米娅", null, null] };
  draft.fiammettaEnabled = true;
  draft.shifts[0]!.fiammettaTarget = "银灰";
  const author = [defaultPosterOperator("阿米娅")!, defaultPosterOperator("银灰")!, defaultPosterOperator("菲亚梅塔")!];
  const personal = [{ ...author[0]!, elite: 1, level: 42 }];
  const document = createPosterDocument(layout, draft, personal);
  const operators = posterOperators(document, author);
  const restored = readPosterFile(JSON.stringify(posterDataOnly({ ...document, operators })));
  const manual = reconcileManualScheduleDraft(posterDraftForManual(restored), layout, personal);
  assert.deepEqual(manual.shifts[0]!.rooms.trade_1?.operators, ["阿米娅", null, null]);
  assert.equal(manual.fiammettaEnabled, true);
  assert.equal(manual.shifts[0]!.fiammettaTarget, "银灰");
  assert.deepEqual(operators, [...personal, ...author.slice(1).map(operator => ({ ...operator, own: false }))]);
});

test("legacy schedules supplement missing references without changing existing Box records", () => {
  const draft = createManualScheduleDraft([24]);
  draft.shifts[0]!.rooms.trade_1 = { operators: ["阿米娅", "巫恋", null] };
  draft.shifts[0]!.fiammettaTarget = "银灰";
  draft.fiammettaEnabled = true;
  const entry = { ...defaultPosterOperator("阿米娅")!, elite: 1, level: 42, own: false };
  const doc = createPosterDocument(layout, draft, [entry]);
  doc.presentation.dormHangerOperators[0] = "锡兰";
  const operators = posterOperators(doc);
  assert.deepEqual(operators[0], entry);
  assert.deepEqual(new Set(operators.map(operator => operator.name)), new Set(["阿米娅", "巫恋", "银灰", "菲亚梅塔", "锡兰"]));
  assert.deepEqual(doc.operators, [entry]);
});
test("external operators default to the highest training permitted by their rarity", () => {
  const maximums = [[0, 30], [0, 30], [1, 55], [2, 70], [2, 80], [2, 90]];
  for (const operator of OPERATOR_CATALOG) {
    const entry = defaultPosterOperator(operator.name)!;
    assert.deepEqual([entry.elite, entry.level], maximums[operator.rarity - 1], operator.name);
    assert.equal(entry.rarity, operator.rarity);
  }
  assert.equal(defaultPosterOperator("not-an-operator"), undefined);
});
test("per-shift products survive MAA conversion and reconciliation", () => {
  const draft = createManualScheduleDraft([12, 12]);
  draft.shifts[1]!.rooms.trade_1 = { operators: [], product: { trade: { order: "originium" } } };
  draft.shifts[1]!.rooms.manu_1 = { operators: [], product: { factory: { recipe: "battle_record" } } };
  const maa = manualScheduleToMaa(reconcileManualScheduleDraft(draft, layout), layout, false);
  assert.equal(maa.plans[0]!.rooms.trading?.[0]?.product, "LMD");
  assert.equal(maa.plans[1]!.rooms.trading?.[0]?.product, "Orundum");
  assert.equal(maa.plans[1]!.rooms.manufacture?.[0]?.product, "Battle Record");
  const imported = createManualScheduleDraftFromCalculator({ layout, maa, fallbackDurations: [], fiammettaEnabled: false, preferMaaTiming: true });
  assert.deepEqual(imported.shifts[1]!.rooms.trade_1?.product, draft.shifts[1]!.rooms.trade_1?.product);
});
test("poster files may omit the first shift start time and use the default for timing", () => {
  const document = createPosterDocument(layout, createManualScheduleDraft([24]));
  document.draft.startTime = "";
  const decoded = readPosterFile(JSON.stringify(posterDataOnly(document)));
  assert.equal(decoded.draft.startTime, "");
  assert.equal(manualScheduleToMaa(decoded.draft, layout, false).plans[0]?.duration, 1440);
});
test("dorm hanger is poster-only and leaves the five-slot schedule unchanged", () => {
  const draft = createManualScheduleDraft([24]);
  draft.shifts[0]!.rooms.dorm_1 = { operators: ["阿米娅", "锡兰", null, null, null], autofill: false };
  const document = createPosterDocument(layout, draft);
  document.presentation.dormHangerOperators[0] = "菲亚梅塔";
  document.operators = [{ id: "char_300_phenxi", name: "菲亚梅塔", elite: 2, level: 60, own: true, potential: 1, rarity: 6 }];
  const decoded = readPosterFile(JSON.stringify(posterDataOnly(document)));
  assert.deepEqual(decoded.draft.shifts[0]!.rooms.dorm_1!.operators, ["阿米娅", "锡兰", null, null, null]);
  assert.equal(decoded.presentation.dormHangerOperators[0], "菲亚梅塔");
  assert.deepEqual(posterDraftForManual(decoded).shifts[0]!.rooms.dorm_1!.operators, ["阿米娅", "锡兰", null, null, null]);
  assert.ok(!posterDraftForManual(decoded).externalOperatorNames.includes("菲亚梅塔"));
  assert.deepEqual(decoded.operators.map(operator => operator.name), ["菲亚梅塔"]);
});
test("import rejects duplicate assignments, low-level orundum, excess capacity and unsupported versions", () => {
  const good = createPosterDocument(layout, createManualScheduleDraft([12, 12]));
  for (const mutate of [
    (doc: typeof good) => { doc.draft.shifts[0]!.rooms.trade_1 = { operators: ["芬", "芬"] }; },
    (doc: typeof good) => { doc.draft.shifts[0]!.rooms.trade_2 = { operators: [], product: { trade: { order: "originium" } } }; },
    (doc: typeof good) => { doc.draft.shifts[0]!.rooms.trade_2 = { operators: ["芬", "香草", "红豆"] }; },
    (doc: typeof good) => { doc.draft.shifts[0]!.rooms.control = { operators: ["芬"], autofillSlots: [5] }; },
    (doc: typeof good) => { doc.draft.shifts[0]!.rooms.training_room = { operators: [], autofillSlots: [0] }; },
    (doc: typeof good) => { doc.draft.shifts[0]!.rooms.control = { operators: [], autofillSlots: [1, 1] }; },
  ]) { const bad = structuredClone(good); mutate(bad); assert.throws(() => readPosterFile(JSON.stringify(bad))); }
  const multiDay = structuredClone(good);
  multiDay.draft.shifts[0]!.durationHours = 20;
  multiDay.draft.shifts[1]!.durationHours = 20;
  assert.deepEqual(readPosterFile(JSON.stringify(multiDay)).draft.shifts.map((shift) => shift.durationHours), [20, 20]);
  assert.throws(() => readPosterFile(JSON.stringify({ ...good, version: 99 })));
});
