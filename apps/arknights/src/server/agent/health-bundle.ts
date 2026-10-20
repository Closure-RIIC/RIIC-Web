import { z } from "zod";

import { extractAccountHealthInput, type AccountHealthInput, type HealthDailyReport, type TrainingOperator } from "../../account-health-input.ts";
import { buildHealthAdvice, holdsDurinGroup, type HealthAdviceReport } from "../../account-health-advice.ts";
import type { HealthDemand } from "../../account-health-demand.ts";

export const healthDemandSchema = z.object({
  orundumPlan: z.enum(["none", "planned"]).describe("搓玉计划：none=暂无，planned=计划进行"),
  outputPriority: z.enum(["maximize", "balanced", "low-maintenance"]).describe("产出与操作取向：优先最大产出 / 兼顾 / 优先省心"),
  resourceFocus: z.enum(["balanced", "lmd", "experience"]).describe("资源侧重点：钱书均衡 / 龙门币 / 作战记录"),
  layoutChange: z.enum(["keep", "recipes-only", "rebuild-ok"]).describe("布局调整范围：保持现有布局 / 只调产线订单 / 可重建布局"),
  twoPowerPlants: z.enum(["accept", "avoid"]).describe("两发电布局：可以接受 / 不接受"),
  loginCadence: z.enum(["twice-daily", "daily", "irregular"]).describe("通常上线节奏：每天至少两次 / 大致每天一次 / 不规律"),
}).partial();

export const reportDaySchema = z.object({
  lmd: z.number().min(0).optional().describe("当日贸易龙门币产值"),
  goldValue: z.number().min(0).optional().describe("当日贵金属价值（赤金枚数 ×500）；只有枚数时先乘 500。三日都缺省时降级为钱书和判读"),
  experience: z.number().min(0).optional().describe("当日作战记录经验"),
  orundum: z.number().min(0).optional().describe("当日合成玉；通常未采集，按 0 计入，可省略"),
  equivalentGoldValue: z.number().min(0).optional().describe("特殊订单等效赤金价值，一般未知，省略"),
}).strict();

export type LoadedInventory = { ok: true; items: Array<{ id: string; count: number }>; fetchedAt: string | null } | { ok: false; reason: string };
export type LoadedOperators = { items: TrainingOperator[]; source: "skland" | "maa" | "sample"; sourceName: string };
export type LoadedReport = { days: HealthDailyReport[]; source: "saved" | "conversation"; createdAt?: string } | null;

export type HealthDataSources = {
  inventory: { available: true; fetchedAt: string | null } | { available: false; reason: string };
  operators: { available: true; source: "skland" | "maa" | "sample"; sourceName: string; isSample: boolean; holdsDurinGroup: boolean } | { available: false };
  report: { available: true; source: "saved" | "conversation"; days: number; createdAt?: string } | { available: false; reason: string };
};

export type HealthBundle = { health: AccountHealthInput; advice: HealthAdviceReport; dataSources: HealthDataSources };

/** 纯组装：已加载的库存/干员池/报表/偏好 → 提炼结果 + 诊断报告 + 数据源标注，不做任何 IO。 */
export function buildHealthBundle(input: {
  inventory?: LoadedInventory;
  operators?: LoadedOperators | null;
  report?: LoadedReport;
  demand?: HealthDemand;
}): HealthBundle {
  const health = extractAccountHealthInput({
    inventory: input.inventory?.ok ? { items: input.inventory.items, fetchedAt: input.inventory.fetchedAt ?? undefined } : undefined,
    operators: input.operators?.items.length ? { items: input.operators.items, source: input.operators.source } : undefined,
    report: input.report ? { days: input.report.days, source: "game-report" } : undefined,
    demand: input.demand,
  });
  const advice = buildHealthAdvice(health, holdsDurinGroup(input.operators?.items, input.operators?.source), "zh");
  return {
    health, advice,
    dataSources: {
      inventory: input.inventory?.ok
        ? { available: true, fetchedAt: input.inventory.fetchedAt }
        : { available: false, reason: input.inventory && !input.inventory.ok ? input.inventory.reason : "未读取库存。" },
      operators: input.operators
        ? {
          available: true, source: input.operators.source, sourceName: input.operators.sourceName,
          isSample: input.operators.source === "sample",
          holdsDurinGroup: holdsDurinGroup(input.operators.items, input.operators.source),
        }
        : { available: false },
      report: input.report
        ? { available: true, source: input.report.source, days: input.report.days.length, createdAt: input.report.createdAt }
        : { available: false, reason: "未保存三日报表，也未通过 reportDays 提供。" },
    },
  };
}

export function stockProfilePayload(bundle: HealthBundle) {
  const { health, advice, dataSources } = bundle;
  return {
    dataSources: { inventory: dataSources.inventory, operators: dataSources.operators },
    inventory: health.inventory,
    stockAnalysis: advice.stock,
    training: health.training,
  };
}

export function productionPayload(bundle: HealthBundle) {
  const { health, advice, dataSources } = bundle;
  return {
    dataSources: { report: dataSources.report },
    report: health.production,
    productionAnalysis: advice.production,
  };
}

export function healthDiagnosisPayload(bundle: HealthBundle) {
  const { advice, dataSources } = bundle;
  return {
    dataSources,
    summary: advice.summary,
    stock: advice.stock,
    production: advice.production,
    recommendation: advice.recommendation,
    notes: advice.notes,
  };
}
