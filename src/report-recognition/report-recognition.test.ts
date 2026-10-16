import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { fileURLToPath } from "node:url";

import { recognizeReport, recognitionProfileIdForRatio } from "./recognize.ts";
import { RECOGNITION_CONFIDENT_DISTANCE, type ReportMetricKey } from "./types.ts";

async function recognizeFixture(name: string) {
  const { data, info } = await sharp(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return recognizeReport({ data, width: info.width, height: info.height });
}

test("clear three-day screenshot locates all panels and production rows", async () => {
  const result = await recognizeFixture("three-day.png");
  assert.ok(!("ok" in result));
  if ("ok" in result) return;
  assert.equal(result.kind, "three-day");
  assert.equal(result.panelCount, 3);
  const expected = [
    { experience: 0, goldValue: 54000, lmd: 85500, orundum: 20 },
    { experience: 0, goldValue: 46000, lmd: 63800, orundum: 480 },
    { experience: 0, goldValue: 39000, lmd: 56000, orundum: 360 },
  ];
  for (const [index, day] of result.days.entries()) {
    for (const [key, value] of Object.entries(expected[index]!)) {
      assert.equal(day[key as ReportMetricKey]?.value, value, `day ${index + 1} ${key}`);
    }
  }
  assert.ok((result.days[0]?.orundum?.maxDistance ?? 1) <= RECOGNITION_CONFIDENT_DISTANCE);
});

test("single-day screenshot requests a three-day report", async () => {
  const result = await recognizeFixture("single-day.png");
  assert.ok(!("ok" in result));
  if ("ok" in result) return;
  assert.equal(result.kind, "single-day");
  assert.equal(result.panelCount, 1);
  assert.ok(result.warnings.includes("single-day-report"));
});

test("three-day zero report preserves legitimate zero values", async () => {
  const result = await recognizeFixture("zero-three-day.png");
  assert.ok(!("ok" in result));
  if ("ok" in result) return;
  for (const day of result.days) {
    assert.deepEqual(Object.fromEntries(Object.entries(day).filter(([key]) => key !== "orderCount").map(([key, item]) => [key, item.value])),
      { experience: 0, goldValue: 0, lmd: 0, orundum: 0 });
  }
});

test("PC screenshot uses the panel's own scale and preserves zero values", async () => {
  const result = await recognizeFixture("pc-three-day.png");
  assert.ok(!("ok" in result));
  if ("ok" in result) return;
  assert.equal(result.panelCount, 3);
  assert.ok(result.days.every((day) =>
    [day.experience, day.goldValue, day.lmd, day.orundum].every((metric) => metric?.value === 0 && metric.maxDistance <= RECOGNITION_CONFIDENT_DISTANCE)));
});

test("downscaled screenshots are flagged for manual reading", async () => {
  const { data, info } = await sharp(fileURLToPath(new URL("./fixtures/three-day.png", import.meta.url)))
    .resize({ width: 1200 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const result = recognizeReport({ data, width: info.width, height: info.height });
  assert.ok(!("ok" in result));
  if ("ok" in result) return;
  assert.equal(result.kind, "three-day");
  assert.ok(result.warnings.includes("low-resolution"));
});

test("three-day screenshot with an extra EXP detail row still reads gold totals", async () => {
  const result = await recognizeFixture("three-day-experience.png");
  assert.ok(!("ok" in result));
  if ("ok" in result) return;
  assert.equal(result.kind, "three-day");
  assert.deepEqual(result.days.map((day) => day.goldValue?.value), [41500, 40000, 40500]);
  assert.deepEqual(result.days.map((day) => day.experience?.value), [31000, 30000, 33000]);
  assert.deepEqual(result.days.map((day) => day.lmd?.value), [61000, 59900, 64600]);
  assert.ok((result.days[0]?.experience?.maxDistance ?? 1) <= RECOGNITION_CONFIDENT_DISTANCE);
});

test("clear nonzero gold report distinguishes 2, 3 and 7 across panels", async () => {
  const result = await recognizeFixture("three-day-gold.png");
  assert.ok(!("ok" in result));
  if ("ok" in result) return;
  assert.equal(result.kind, "three-day");
  assert.deepEqual(result.days.map((day) => day.goldValue?.value), [67000, 67500, 65500]);
  assert.deepEqual(result.days.map((day) => day.lmd?.value), [79500, 83000, 82000]);
});

test("PC trade rows include LMD order counts", async () => {
  const result = await recognizeFixture("pc-three-day-orders.png");
  assert.ok(!("ok" in result));
  if ("ok" in result) return;
  assert.equal(result.kind, "three-day");
  assert.deepEqual(result.days.map((day) => day.lmd?.value), [79500, 82000, 82000]);
  assert.deepEqual(result.days.map((day) => day.orderCount?.value), [39, 39, 40]);
  assert.ok(result.days.every((day) => (day.orderCount?.maxDistance ?? 1) <= RECOGNITION_CONFIDENT_DISTANCE));
});

test("dark-panel report keeps every order count inside the confident distance", async () => {
  const result = await recognizeFixture("three-day-dark-panel-orders.png");
  assert.ok(!("ok" in result));
  if ("ok" in result) return;
  assert.equal(result.kind, "three-day");
  assert.equal(result.panelCount, 3);
  assert.deepEqual(result.days.map((day) => day.lmd?.value), [78000, 76000, 84200]);
  assert.deepEqual(result.days.map((day) => day.orderCount?.value), [44, 45, 50]);
  // 第三面板的白色订单数字比模板细一档，修复前距离 0.201 会被界面当作不可信而留空。
  assert.ok(result.days.every((day) => (day.orderCount?.maxDistance ?? 1) <= RECOGNITION_CONFIDENT_DISTANCE));
});

test("compressed screenshot still locates all three facility panels", async () => {
  const result = await recognizeFixture("compressed-three-day.jpg");
  assert.ok(!("ok" in result));
  if ("ok" in result) return;
  assert.equal(result.kind, "three-day");
  assert.equal(result.panelCount, 3);
});

test("ratio profiles select the wide strip template without rejecting normal cropped reports", () => {
  assert.equal(recognitionProfileIdForRatio(1763 / 991), "standard");
  assert.equal(recognitionProfileIdForRatio(1807 / 872), "wide-strip");
  assert.equal(recognitionProfileIdForRatio(1.2), "fallback");
});

test("normal report profile accepts the compressed three-day fixture", async () => {
  const result = await recognizeFixture("compressed-three-day.jpg");
  assert.ok(!("ok" in result));
  if ("ok" in result) return;
  assert.equal(result.profile, "standard");
  assert.ok(!result.warnings.includes("odd-aspect-ratio"));
});
