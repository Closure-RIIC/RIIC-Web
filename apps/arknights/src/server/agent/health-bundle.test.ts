import assert from "node:assert/strict";
import test from "node:test";

import { HEALTH_DEMAND_FIELDS, HEALTH_DEMAND_OPTIONS } from "../../account-health-demand.ts";
import {
  buildHealthBundle, healthDemandSchema, healthDiagnosisPayload, productionPayload, reportDaySchema, stockProfilePayload,
} from "./health-bundle.ts";

const operator = (id: string, rarity: number, level: number, modules: Array<{ id: string; level: number; locked: boolean; name: string; isDefault: boolean }> = []) =>
  ({ id, name: id, rarity, elite: 2, level, modules });

const durinPool = { items: [
  operator("char_4055_bgsnow", 6, 90), operator("char_478_kirara", 6, 80), operator("char_402_tuye", 6, 60),
  operator("d", 5, 50),
], source: "skland" as const, sourceName: "森空岛·测试博士" };

const inventory = { ok: true as const, items: [
  { id: "4001", count: 2_000_000 }, { id: "2004", count: 4_000 }, { id: "3003", count: 240 },
  { id: "4004", count: 258 },
], fetchedAt: "2026-09-25T00:00:00Z" };

const report = { days: Array.from({ length: 3 }, () => ({ lmd: 40_000, goldValue: 50_000, experience: 32_000 })), source: "saved" as const, createdAt: "2026-09-25T00:00:00Z" };

test("demand schema stays aligned with the persisted preference fields", () => {
  assert.deepEqual(Object.keys(healthDemandSchema.shape).sort(), [...HEALTH_DEMAND_FIELDS].sort());
  for (const field of HEALTH_DEMAND_FIELDS) {
    const value = HEALTH_DEMAND_OPTIONS[field][0] as string;
    const parsed = healthDemandSchema.parse({ [field]: value }) as Record<string, unknown>;
    assert.equal(parsed[field], value);
  }
  assert.equal(healthDemandSchema.safeParse({ orundumPlan: "considering" }).success, false);
  // 未知键（如已下线的换班容忍度）被剥离而不是报错，与 localStorage 归一化行为一致。
  assert.deepEqual(healthDemandSchema.parse({ shiftTolerance: "none" }), {});
});

test("report day schema accepts partial narration and rejects negative values", () => {
  assert.equal(reportDaySchema.safeParse({ lmd: 40_000, experience: 32_000 }).success, true);
  assert.equal(reportDaySchema.safeParse({ goldValue: -1 }).success, false);
  assert.equal(reportDaySchema.safeParse({ extra: 1 }).success, false);
});

test("stock profile payload exposes inventory, analysis and training with sources", () => {
  const payload = stockProfilePayload(buildHealthBundle({ inventory, operators: durinPool }));
  assert.equal(payload.inventory?.lmd, 2_000_000);
  assert.equal(payload.inventory?.directPulls, 38);
  assert.equal(payload.stockAnalysis?.goldSurplus, "clear");
  assert.ok((payload.stockAnalysis?.lmdShort ?? 0) > 1_000_000);
  assert.equal(payload.training?.usableForPersonalAssessment, true);
  assert.ok(payload.dataSources.inventory.available);
  assert.ok(payload.dataSources.operators.available && payload.dataSources.operators.holdsDurinGroup);
  assert.equal("report" in payload.dataSources, false);
});

test("production payload grades saved reports and reports data source only for reports", () => {
  const payload = productionPayload(buildHealthBundle({ report }));
  assert.equal(payload.report?.capacityIndex, 96_000);
  assert.equal(payload.productionAnalysis?.grade, "pass");
  assert.equal(payload.productionAnalysis?.dailyLmdIn, 70_000);
  assert.equal(payload.productionAnalysis?.goldNetUnits, 30);
  assert.deepEqual(payload.dataSources.report, { available: true, source: "saved", days: 3, createdAt: "2026-09-25T00:00:00Z" });
  assert.equal("inventory" in payload.dataSources, false);
});

test("conversation report days override saved reports and degrade without gold data", () => {
  const payload = productionPayload(buildHealthBundle({
    report: { days: [{ lmd: 40_000, experience: 32_000 }, { lmd: 40_000, experience: 32_000 }, { lmd: 40_000, experience: 32_000 }], source: "conversation" },
  }));
  assert.equal(payload.report?.capacityIndex, null);
  assert.equal(payload.productionAnalysis?.degraded, true);
  assert.equal(payload.productionAnalysis?.grade, "pass");
  const source = payload.dataSources.report;
  assert.ok(source.available && source.source === "conversation");
});

test("diagnosis payload combines all sources and honors preferences", () => {
  const bundle = buildHealthBundle({ inventory, operators: durinPool, report, demand: { orundumPlan: "planned", outputPriority: "low-maintenance" } });
  const payload = healthDiagnosisPayload(bundle);
  assert.match(payload.summary, /推测钱书需求比/);
  assert.equal(payload.recommendation?.layout, "333");
  assert.match(payload.recommendation?.shifts.join(""), /搓玉期/);
  assert.equal(payload.notes.length, 0);
});

test("missing inputs are reported, never fabricated", () => {
  const payload = healthDiagnosisPayload(buildHealthBundle({}));
  assert.equal(payload.stock, null);
  assert.equal(payload.production, null);
  assert.equal(payload.dataSources.inventory.available, false);
  assert.equal(payload.dataSources.operators.available, false);
  assert.ok(!payload.dataSources.report.available);
  assert.ok(payload.notes.length >= 3);
  assert.ok(payload.recommendation);
});

test("inventory failure carries its reason instead of counting as zero stock", () => {
  const payload = stockProfilePayload(buildHealthBundle({ inventory: { ok: false, reason: "未绑定森空岛" }, operators: durinPool }));
  assert.deepEqual(payload.dataSources.inventory, { available: false, reason: "未绑定森空岛" });
  assert.equal(payload.inventory, null);
});
