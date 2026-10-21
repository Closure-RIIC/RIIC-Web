import assert from "node:assert/strict";
import test from "node:test";

import * as XLSX from "xlsx";

import { assertOperbox, readOperboxFile, readOperboxText } from "./operbox.ts";
import { inspectMaaProgress, normalizeMaaRarities } from "./maa-review.ts";
import { computePlan, putCloudWorkspace, submitPlanTask } from "./api.ts";

const entry = {
  id: "char_test",
  name: "测试干员",
  elite: 2,
  level: 90,
  own: true,
  potential: 1,
  rarity: 6,
};

test("MAA imports clamp every rarity's stage and level ceiling", async () => {
  const limits = [[30], [30], [40, 55], [45, 60, 70], [50, 70, 80], [50, 80, 90]];
  for (const [index, levels] of limits.entries()) {
    const rarity = index + 1;
    for (const [elite, maxLevel] of levels.entries()) {
      const [result] = await readOperboxText(JSON.stringify([{ ...entry, rarity, elite, level: 999 }]));
      assert.equal(result.elite, elite);
      assert.equal(result.level, maxLevel);
    }
    const [result] = await readOperboxText(JSON.stringify([{ ...entry, rarity, elite: 3, level: 1 }]));
    assert.equal(result.elite, levels.length - 1);
    assert.equal(result.level, levels.at(-1));
  }
});

test("MAA imports preserve valid levels and unowned placeholders", async () => {
  const valid = { ...entry, elite: 0, level: 10 };
  const placeholder = { ...entry, own: false, rarity: 1, elite: -1, level: 0, potential: 0 };
  assert.deepEqual(await readOperboxText(JSON.stringify([valid])), [valid]);
  assert.deepEqual(await readOperboxText(JSON.stringify([placeholder])), [placeholder]);
});

test("MAA review and import use canonical rarity while submission remains strict", async () => {
  const incorrect = { ...entry, id: "char_285_medic2", name: "Lancet-2", rarity: 6 };
  const [issue] = inspectMaaProgress([incorrect]);
  assert.equal(issue.rarity, 1);
  assert.equal(issue.choices.some((choice) => choice.elite > 0), false);
  const [imported] = await readOperboxText(JSON.stringify([incorrect]));
  assert.equal(imported.rarity, 1);
  assert.equal(imported.elite, 0);
  assert.equal(imported.level, 30);
  assert.throws(() => assertOperbox([incorrect]), /rarity/);
  assert.deepEqual(normalizeMaaRarities(null), null);
});

test("MAA review preserves valid progression and offers an inferred elite stage", () => {
  assert.deepEqual(inspectMaaProgress([{ ...entry, level: 80 }]), []);
  const [issue] = inspectMaaProgress([{ ...entry, elite: 0, level: 80 }]);
  assert.ok(issue.choices.some((choice) => choice.own && choice.elite === 1 && choice.level === 80));
  assert.deepEqual(inspectMaaProgress([{ ...entry, own: false, elite: -1, level: 0 }]), []);
});

test("JSON imports do not load the XLSX parser", async () => {
  let xlsxRequested = false;
  const file = new File([JSON.stringify([entry])], "operators.json", { type: "application/json" });
  const result = await readOperboxFile(file, async () => {
    xlsxRequested = true;
    throw new Error("XLSX should not load for JSON files");
  });

  assert.equal(xlsxRequested, false);
  assert.deepEqual(result, [entry]);
});

test("localized MAA JSON names are converted to Simplified Chinese during import", async () => {
  const localizedEntries = [
    { ...entry, id: "char_002_amiya", name: "アーミヤ", rarity: 5, level: 80 },
    { ...entry, id: "char_003_kalts", name: "凱爾希" },
    { ...entry, id: "char_010_chen", name: "Ch'en" },
    { ...entry, id: "char_017_huang", name: "煌" },
  ];

  assert.deepEqual(
    (await readOperboxText(JSON.stringify(localizedEntries))).map(({ id, name }) => ({ id, name })),
    [
      { id: "char_002_amiya", name: "阿米娅" },
      { id: "char_003_kalts", name: "凯尔希" },
      { id: "char_010_chen", name: "陈" },
      { id: "char_017_huang", name: "煌" },
    ],
  );
});

test("Excel imports still parse compatible operator rows", async () => {
  const worksheet = XLSX.utils.json_to_sheet([entry]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Operators");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  const file = new File([bytes], "operators.xlsx");

  assert.deepEqual(await readOperboxFile(file, async () => XLSX), [entry]);
});

test("invalid Excel imports remain recoverable errors", async () => {
  const file = new File([new Uint8Array([1, 2, 3, 4])], "broken.xlsx");
  await assert.rejects(() => readOperboxFile(file, async () => XLSX), Error);
});

test("owned operator progression respects every rarity and elite-stage boundary", () => {
  const limits = [[30], [30], [40, 55], [45, 60, 70], [50, 70, 80], [50, 80, 90]];
  limits.forEach((levels, index) => {
    const rarity = index + 1;
    levels.forEach((level, elite) => {
      assert.doesNotThrow(() => assertOperbox([{ ...entry, rarity, elite, level }]));
      assert.throws(() => assertOperbox([{ ...entry, rarity, elite, level: level + 1 }]), /level/);
    });
    assert.throws(() => assertOperbox([{ ...entry, rarity, elite: levels.length, level: 1 }]), /elite/);
  });
});

test("canonical operator IDs cannot spoof rarity to bypass progression limits", () => {
  for (const id of ["char_002_amiya", "002_amiya"]) {
    assert.throws(() => assertOperbox([{ ...entry, id }]), /rarity/);
    assert.doesNotThrow(() => assertOperbox([{ ...entry, id, rarity: 5, level: 80 }]));
  }
  assert.throws(() => assertOperbox([{ ...entry, id: "char_285_medic2", rarity: 6 }]), /rarity/);
});

test("unowned import placeholders do not require owned progression", () => {
  assert.doesNotThrow(() => assertOperbox([{ ...entry, own: false, rarity: 1, elite: -1, level: 0, potential: 0 }]));
});

test("invalid progression is rejected before plan, task, or cloud HTTP requests", async (context) => {
  const fetch = context.mock.method(globalThis, "fetch", async () => { throw new Error("unexpected HTTP request"); });
  const payload = {
    layout: { template: "243", drone_cap: 200, scenario: {}, rooms: [] },
    operbox: [{ ...entry, rarity: 1 }], sourceName: "fixture", boxSource: "maa" as const, rotation: "abc_12_6_6" as const,
  };
  await assert.rejects(computePlan(payload), { code: "AIC-BOX-1101", retryable: false });
  await assert.rejects(submitPlanTask(payload), { code: "AIC-BOX-1101", retryable: false });
  await assert.rejects(putCloudWorkspace({ state: { boxSource: "maa" } as never, operbox: payload.operbox, result: null }), { code: "AIC-DATA-8003", retryable: false });
  assert.equal(fetch.mock.callCount(), 0);
});
