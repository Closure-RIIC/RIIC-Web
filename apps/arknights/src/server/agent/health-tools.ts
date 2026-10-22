import "@tanstack/react-start/server-only";

import { tool } from "ai";
import { z } from "zod";

import { loadStatusSnapshot, loadInventorySnapshot } from "@riic/platform-server/skland/adapter";
import { activeSklandAccount, readSklandAccountStore } from "@riic/platform-server/skland/http";
import { getMaaOperboxSnapshot } from "@riic/platform-server/workspace";
import { getSampleOperbox } from "@riic/platform-server/infra";
import { latestGameReport } from "@/server/game-report-store";
import type { HealthDailyReport, TrainingOperator } from "@/account-health-input";
import {
  buildHealthBundle, healthDemandSchema, healthDiagnosisPayload, productionPayload, reportDaySchema, stockProfilePayload,
  type LoadedInventory, type LoadedOperators, type LoadedReport,
} from "./health-bundle.ts";

type Guard = <T>(name: string, input: unknown, run: () => Promise<T>) => Promise<T | { error: string }>;
type HealthToolContext = { userId: string };

async function loadHealthInventory(ctx: HealthToolContext): Promise<LoadedInventory> {
  try {
    const store = await readSklandAccountStore(ctx.userId);
    const account = activeSklandAccount(store);
    if (!account) return { ok: false, reason: "当前浏览器没有可用的森空岛登录态，请先在「森空岛」页面扫码或导入凭证。" };
    const { inventory } = await loadInventorySnapshot(account.session);
    return { ok: true, items: inventory.items, fetchedAt: inventory.fetchedAt };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "森空岛库存读取失败。" };
  }
}

async function loadHealthOperators(ctx: HealthToolContext): Promise<LoadedOperators | null> {
  try {
    const store = await readSklandAccountStore(ctx.userId);
    const account = activeSklandAccount(store);
    if (account) {
      const { snapshot } = await loadStatusSnapshot(account.session);
      if (snapshot.operators.length) {
        return { items: snapshot.operators, source: "skland", sourceName: `森空岛·${snapshot.player.nickname}` };
      }
    }
  } catch {
    // 森空岛不可用时继续读取云端干员池。
  }
  try {
    const operbox = await getMaaOperboxSnapshot(ctx.userId);
    if (operbox?.length) return { items: operbox, source: "maa", sourceName: "MAA 上传干员池" };
  } catch {
    // 云端不可用时使用站内全精二示例。
  }
  const sample = await getSampleOperbox();
  const operbox = sample.operbox as TrainingOperator[];
  if (!operbox.length) return null;
  return { items: operbox, source: "sample", sourceName: "全精二示例干员池" };
}

async function loadHealthReport(ctx: HealthToolContext, overrideDays?: Array<z.infer<typeof reportDaySchema>>): Promise<LoadedReport> {
  if (overrideDays?.length) return { days: overrideDays as HealthDailyReport[], source: "conversation" };
  try {
    const record = await latestGameReport(ctx.userId);
    return record ? { days: record.days, source: "saved", createdAt: record.createdAt } : null;
  } catch {
    return null;
  }
}

export function buildHealthTools(ctx: HealthToolContext, guard: Guard) {
  return {
    analyze_stock_and_training: tool({
      description:
        "资源库存与培养画像：读取森空岛库存（龙门币、四档作战记录折算经验、赤金枚数、含黄票阶梯兑换与源石折算的可用常规抽数、库存钱书比），并按干员池全部精二干员的实际消耗推测钱书需求比（纯等级与含模组两种），给出库存缺口与赤金盈余判断；培养画像含分星级持有/精二/模组统计。干员池按森空岛→MAA→示例兜底，示例池不用于个人需求比；库存读不到时返回原因，不按零库存计算。查绑定状态、干员持有或当前布局用 diagnose_account；查日产出用 analyze_daily_production；要布局推荐用 diagnose_account_health。",
      inputSchema: z.object({}).strict(),
      execute: async (input) => guard("analyze_stock_and_training", input, async () => {
        const [inventory, operators] = await Promise.all([loadHealthInventory(ctx), loadHealthOperators(ctx)]);
        return stockProfilePayload(buildHealthBundle({ inventory, operators }));
      }),
    }),
    analyze_daily_production: tool({
      description:
        "基建三日报表与日产出计算：未提供 reportDays 时读取账号体检页已保存的三日报表；用户在对话中口述数字时传入 reportDays 覆盖已保存数据（贵金属按价值口径，只有赤金枚数时先乘 500；未采集合成玉按 0 计入可省略）。输出产能指数与档位（低于 9 万不及格 / 9~10 万合格 / 10~11 万良好 / 11 万以上优秀，缺贵金属数据时降级为钱书和判读）、基建生产与含基建外获取的综合钱书比、赤金每日净盈亏与库存耗尽预测、钱书按需求比的每日净流（净流方向需库存与培养画像数据）。查库存与培养画像用 analyze_stock_and_training；要布局推荐用 diagnose_account_health。",
      inputSchema: z.object({
        reportDays: z.array(reportDaySchema).length(3).optional().describe("用户口述的三日报表数值（最旧在前），提供时覆盖已保存报表；省略则读取已保存报表"),
      }).strict(),
      execute: async (input) => guard("analyze_daily_production", input, async () => {
        const report = await loadHealthReport(ctx, input.reportDays);
        // 净流方向依赖库存缺口与需求比，一并拉取；任一来源失败不阻断产出计算。
        const [inventory, operators] = await Promise.all([loadHealthInventory(ctx), loadHealthOperators(ctx)]);
        return productionPayload(buildHealthBundle({ inventory, operators, report }));
      }),
    }),
    diagnose_account_health: tool({
      description:
        "账号体检综合诊断：联合库存、培养画像与三日报表，输出概述结论、钱书缺口补平或扩大的预测、赤金盈余与耗尽预测，并按决策树推荐基建布局、产线配比与换班方式（例如严重缺龙门币且持有鸿雪杜林组时推荐 342 纯钱表；搓玉、保持布局、上线节奏等偏好会改变推荐）。demand 为基建使用偏好，只存在用户浏览器本地、服务端读不到，请从对话询问用户后传入，未提供的项按未设置处理并给默认推荐；reportDays 可在用户口述报表数字时覆盖已保存报表。数据缺口会在 notes 中明确列出，不编造数值。只查绑定状态、干员持有或当前布局用 diagnose_account。",
      inputSchema: z.object({
        demand: healthDemandSchema.describe("基建使用偏好（搓玉计划、产出取向、资源侧重、布局调整、两发电、上线节奏），仅传用户明确回答的项"),
        reportDays: z.array(reportDaySchema).length(3).optional().describe("用户口述的三日报表数值（最旧在前），提供时覆盖已保存报表"),
      }).strict(),
      execute: async (input) => guard("diagnose_account_health", input, async () => {
        const [inventory, operators, report] = await Promise.all([
          loadHealthInventory(ctx), loadHealthOperators(ctx), loadHealthReport(ctx, input.reportDays),
        ]);
        const bundle = buildHealthBundle({ inventory, operators, report, demand: input.demand });
        const payload = healthDiagnosisPayload(bundle);
        return Object.keys(input.demand).length ? payload
          : { ...payload, demandNote: "未提供基建使用偏好，布局与换班按默认口径推荐；询问用户后带 demand 重调可得个性化结果。" };
      }),
    }),
  };
}
