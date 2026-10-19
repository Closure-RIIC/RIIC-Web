import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPosterDocument, readPosterFile, posterDataOnly, posterDraftForManual } from "./schedule-poster-document.ts";
import { assignManualOperator, createManualScheduleDraft, createManualScheduleDraftFromCalculator, manualScheduleToMaa, reconcileManualScheduleDraft, loadManualScheduleDraft } from "./manual-schedule.ts";
import type { BaseBlueprint } from "./types.ts";

const layout = JSON.parse(readFileSync(new URL("./layouts/252.json", import.meta.url), "utf8")) as BaseBlueprint;
test("editable work file preserves shift products, efficiency, training roles and dormant facilities", () => {
  const draft = createManualScheduleDraft([8, 8, 8]);
  draft.shifts[0]!.rooms.trade_1 = { operators: ["巫恋", "卡夫卡", "龙舌兰"], manualSkillEfficiencyPct: 125 };
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
  assert.deepEqual(manual.shifts[1]!.rooms.trade_1?.product, { trade: { order: "originium" } });
  const edited = assignManualOperator({ draft: manual, layout, shiftIndex: 0, roomId: "trade_1", slotIndex: 1, operator: "但书" }).draft;
  assert.equal(edited.shifts[0]!.rooms.trade_1?.operators[1], "但书");
  assert.deepEqual(edited.shifts[1], manual.shifts[1]);
  const persisted = loadManualScheduleDraft({ getItem: () => JSON.stringify(edited), setItem: () => {} });
  assert.deepEqual(persisted?.shifts[1]!.rooms.trade_1?.product, draft.shifts[1]!.rooms.trade_1?.product);
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
  ]) { const bad = structuredClone(good); mutate(bad); assert.throws(() => readPosterFile(JSON.stringify(bad))); }
  const multiDay = structuredClone(good);
  multiDay.draft.shifts[0]!.durationHours = 20;
  multiDay.draft.shifts[1]!.durationHours = 20;
  assert.deepEqual(readPosterFile(JSON.stringify(multiDay)).draft.shifts.map((shift) => shift.durationHours), [20, 20]);
  assert.throws(() => readPosterFile(JSON.stringify({ ...good, version: 99 })));
});
