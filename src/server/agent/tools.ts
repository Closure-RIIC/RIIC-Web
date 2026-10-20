import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { tool } from "ai";
import { z } from "zod";

import { PRESETS, buildBlueprint, factoryRecipeFor, tradeOrderFor, updateFactoryRecipe, updateRoomLevel, updateTradeOrder } from "@/blueprint";
import type { FactoryRecipe } from "@/factory-recipes";
import type { TradeOrder } from "@/blueprint";
import { runPlan, getSampleOperbox } from "@/server/infra";
import { toPublicPlanData } from "@/server/public-plan";
import { loadInventorySnapshot, loadStatusSnapshot } from "@/server/skland/adapter";
import { activeSklandAccount, readSklandAccountStore } from "@/server/skland/http";
import { sklandDataOwnerTag } from "@/server/skland/session";
import { getMaaOperboxSnapshot, listSavedPlans } from "@/server/workspace";
import { createRequestId } from "@/server/api-contract";
import type { BaseBlueprint, OperBoxEntry, RotationProfile } from "@/types";
import { projectPlanResult } from "./plan-artifact.ts";
import { readKnowledgeDoc, searchKnowledgeBase } from "./knowledge.ts";
import { readAgentSkill } from "./knowledge-policy.ts";
import { agentKnowledgeDir } from "./config.ts";
import { queryAgentSkills, inspectAgentOperators } from "./operator-tools.ts";
import { observeMasteryEnvironment, type MasteryEnvironmentObservation } from "./mastery-environment.ts";
import { buildCalculatorTools, type AgentOperatorPool, type AgentTrainingResources } from "./calculator-tools.ts";
import { buildHealthTools } from "./health-tools.ts";
import { chargeAgentTool } from "@/server/billing/service";
import { SOLVE_TOOL_POINTS } from "@/server/billing/config";
import { resourceSkill, type AgentResourcePolicy } from "./resource-policy.ts";

export interface AgentToolContext {
  request: Request;
  userId: string;
  gatewayBilling?: boolean;
  resources?: AgentResourcePolicy;
}

const ROTATION_PROFILES: RotationProfile[] = ["abc_12_6_6", "abc_12_12_12", "main_backup_12_12", "fiammetta_8_8_4_4", "abyssal_7_5_7_5"];
const SOLVE_TIMEOUT_MS = 180_000;

function logToolCall(userId: string, name: string, input: unknown, startedAt: number, failed: boolean) {
  console.log(JSON.stringify({
    level: "info",
    event: "agent_tool_call",
    userId,
    tool: name,
    failed,
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    inputKeys: input && typeof input === "object" ? Object.keys(input) : [],
  }));
}

async function guarded<T>(userId: string, name: string, input: unknown, run: () => Promise<T>): Promise<T | { error: string }> {
  const startedAt = performance.now();
  try {
    const result = await run();
    logToolCall(userId, name, input, startedAt, false);
    return result;
  } catch (error) {
    logToolCall(userId, name, input, startedAt, true);
    return { error: error instanceof Error ? error.message : "工具执行失败。" };
  }
}

interface SklandSnapshotForTools {
  masteryEnvironment: MasteryEnvironmentObservation;
  operbox: OperBoxEntry[];
  dataOwnerTag: string;
  sourceName: string;
  player: {
    nickname: string;
    level: number | null;
    sanity: { current: number; max: number } | null;
    operatorCount: number | null;
  };
  infrastructure: {
    layoutLabel: string | null;
    rooms: Array<{ key: string; group: string; level: number; operatorCount: number }>;
  };
  warnings: string[];
}

async function loadSklandSnapshot(ctx: AgentToolContext): Promise<SklandSnapshotForTools> {
  const store = await readSklandAccountStore(ctx.userId);
  const account = activeSklandAccount(store);
  if (!account) {
    throw new Error("当前浏览器没有可用的森空岛登录态，请先在「森空岛」页面扫码或导入凭证。");
  }
  const { snapshot } = await loadStatusSnapshot(account.session);
  return {
    masteryEnvironment: observeMasteryEnvironment(snapshot),
    operbox: snapshot.operbox,
    dataOwnerTag: sklandDataOwnerTag(account.session.userId),
    sourceName: `森空岛·${snapshot.player.nickname}`,
    player: {
      nickname: snapshot.player.nickname,
      level: snapshot.player.level,
      sanity: snapshot.player.sanity ? { current: snapshot.player.sanity.current, max: snapshot.player.sanity.max } : null,
      operatorCount: snapshot.player.counts.operators ?? null,
    },
    infrastructure: {
      layoutLabel: snapshot.infrastructure.layoutLabel,
      rooms: snapshot.infrastructure.rooms.map((room) => ({
        key: room.key,
        group: room.group,
        level: room.level,
        operatorCount: room.operators.length,
      })),
    },
    warnings: snapshot.warnings,
  };
}

function operboxStats(operbox: OperBoxEntry[]) {
  const byRarity = new Map<number, number>();
  let elite2 = 0;
  for (const entry of operbox) {
    if (entry.own) byRarity.set(entry.rarity, (byRarity.get(entry.rarity) ?? 0) + 1);
    if (entry.own && entry.elite === 2) elite2 += 1;
  }
  const elite2SixStar = operbox
    .filter((entry) => entry.own && entry.elite === 2 && entry.rarity === 6)
    .map((entry) => entry.name);
  return {
    owned: [...byRarity.values()].reduce((sum, count) => sum + count, 0),
    elite2,
    byRarity: Object.fromEntries([...byRarity.entries()].sort((a, b) => b[0] - a[0]).map(([rarity, count]) => [`star${rarity}`, count])),
    elite2SixStarNames: elite2SixStar,
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

type SolveScenario = "balanced" | "orundum" | "money";

interface SolveDefaults {
  layoutPreset: string;
  layoutSource: "skland_layout" | "saved_plan" | "fallback";
  boxSource: "skland" | "maa" | "sample";
}

const FALLBACK_LAYOUT_PRESET = "243";
const DEFAULT_ROTATION = "abc_12_12_12";

/** 搓玉场景默认配方（按布局预设）。153/252 没有搓玉默认配置。 */
const ORUNDUM_SCENARIOS: Partial<Record<string, { tradeOrders: TradeOrder[]; manufactureRecipes: FactoryRecipe[]; roomLevelOverrides?: Record<string, number> }>> = {
  "243": {
    tradeOrders: ["gold", "originium"],
    manufactureRecipes: ["gold", "gold", "battle_record", "originium"],
  },
  "333": {
    tradeOrders: ["gold", "gold", "originium"],
    manufactureRecipes: ["gold", "gold", "originium"],
  },
  "342": {
    tradeOrders: ["gold", "gold", "originium"],
    manufactureRecipes: ["gold", "gold", "gold", "originium"],
    roomLevelOverrides: { manu_1: 2, manu_2: 2, manu_4: 3, trade_3: 3 },
  },
};

/**
 * solve_schedule 的默认配置兜底：用户没说布局预设与干员来源时，
 * 依次从「当前游戏内基建布局（森空岛）→ 最近保存的排班 → 243」推断布局；
 * 干员来源按「森空岛 → MAA 上传文件 → 示例 Box」三级降级。
 */
async function resolveSolveDefaults(ctx: AgentToolContext): Promise<SolveDefaults> {
  let layoutPreset: string | null = null;
  let layoutSource: SolveDefaults["layoutSource"] = "fallback";
  let boxSource: SolveDefaults["boxSource"] = "sample";
  try {
    const skland = await loadSklandSnapshot(ctx);
    // 森空岛登录正常但干员池为空时不能作为求解干员来源，继续按 MAA → 示例降级。
    if (skland.operbox.length > 0) boxSource = "skland";
    const label = skland.infrastructure.layoutLabel;
    if (label && PRESETS.some((preset) => preset.label === label)) {
      layoutPreset = label;
      layoutSource = "skland_layout";
    }
  } catch {
    // 森空岛不可用：干员来源继续探测 MAA 上传。
  }
  if (boxSource === "sample") {
    try {
      const maa = await getMaaOperboxSnapshot(ctx.userId);
      if (maa && maa.length > 0) boxSource = "maa";
    } catch {
      // MAA 快照不可用：降级为 sample。
    }
  }
  if (!layoutPreset) {
    try {
      const plans = await listSavedPlans(ctx.userId);
      const label = plans.plans[0]?.calculationContext?.presetLabel ?? null;
      if (label && PRESETS.some((preset) => preset.label === label)) {
        layoutPreset = label;
        layoutSource = "saved_plan";
      }
    } catch {
      // 历史排班不可用：走兜底。
    }
  }
  return {
    layoutPreset: layoutPreset ?? FALLBACK_LAYOUT_PRESET,
    layoutSource,
    boxSource,
  };
}

const LAYOUT_SOURCE_LABELS: Record<SolveDefaults["layoutSource"], string> = {
  skland_layout: "来自当前游戏内基建布局",
  saved_plan: "来自最近一次保存的排班",
  fallback: "未找到可推断的布局，使用默认值",
};

function boxSourceNote(boxSource: "skland" | "maa" | "sample"): string {
  if (boxSource === "skland") return "干员数据来自森空岛同步";
  if (boxSource === "maa") return "干员数据来自最近一次上传的 MAA 文件（云端工作区）";
  return "森空岛未绑定、MAA 未上传，将自动改用 243 全精二示例 Box；如需真实干员池请先绑定森空岛或在工作台上传 MAA 文件";
}

/** 按场景把配方/订单应用到布局；返回应用后的说明。搓玉会做必要的房间等级修正。 */
function applyScenario(
  layout: BaseBlueprint,
  presetLabel: string,
  scenario: SolveScenario
): { layout: BaseBlueprint; scenarioNote: string } {
  if (scenario === "orundum") {
    const config = ORUNDUM_SCENARIOS[presetLabel];
    if (!config) {
      return { layout, scenarioNote: `${presetLabel} 布局当前没有标准搓玉默认配置，已沿用布局默认配方；如需使用内置搓玉配置请换 243/333/342 布局。` };
    }
    let next = layout;
    for (const [roomId, level] of Object.entries(config.roomLevelOverrides ?? {})) {
      next = updateRoomLevel(next, roomId, level);
    }
    const factoryRooms = next.rooms.filter((room) => room.kind === "factory");
    for (const [index, recipe] of config.manufactureRecipes.entries()) {
      const room = factoryRooms[index];
      if (room) next = updateFactoryRecipe(next, room.id, recipe);
    }
    const tradeRooms = next.rooms.filter((room) => room.kind === "trade_post");
    for (const [index, order] of config.tradeOrders.entries()) {
      const room = tradeRooms[index];
      if (room) next = updateTradeOrder(next, room.id, order);
    }
    return { layout: next, scenarioNote: "搓玉默认配置已应用（贸易线 + 碎片线两条都配齐）。" };
  }
  if (scenario === "money") {
    let next = layout;
    const factoryRooms = next.rooms.filter((room) => room.kind === "factory");
    for (const room of factoryRooms) next = updateFactoryRecipe(next, room.id, "gold");
    const tradeRooms = next.rooms.filter((room) => room.kind === "trade_post");
    for (const room of tradeRooms) next = updateTradeOrder(next, room.id, "gold");
    return { layout: next, scenarioNote: "产钱配置已应用：全部贸易站交龙门商法、全部制造站产赤金。" };
  }
  return { layout, scenarioNote: "沿用布局默认配方。" };
}

async function loadAgentOperatorPool(ctx: AgentToolContext): Promise<AgentOperatorPool> {
  try {
    const snapshot = await loadSklandSnapshot(ctx);
    if (snapshot.operbox.length) return { operbox: snapshot.operbox, source: "skland", sourceName: snapshot.sourceName, masteryEnvironment: snapshot.masteryEnvironment };
  } catch {
    // 森空岛不可用时继续读取云端干员池。
  }
  try {
    const operbox = await getMaaOperboxSnapshot(ctx.userId);
    if (operbox?.length) return { operbox, source: "maa", sourceName: "MAA 上传干员池" };
  } catch {
    // 云端不可用时使用站内全精二示例。
  }
  const sample = await getSampleOperbox();
  return { operbox: sample.operbox as OperBoxEntry[], source: "sample", sourceName: "全精二示例干员池" };
}

async function loadAgentTrainingResources(ctx: AgentToolContext): Promise<AgentTrainingResources> {
  const store = await readSklandAccountStore(ctx.userId);
  const account = activeSklandAccount(store);
  if (!account) throw new Error("需要先绑定森空岛，才能读取当前干员练度和仓库库存。");
  const [status, inventory] = await Promise.all([
    loadStatusSnapshot(account.session),
    loadInventorySnapshot(account.session),
  ]);
  return {
    operators: status.snapshot.operators,
    inventory: inventory.inventory.items,
    sourceName: `森空岛·${status.snapshot.player.nickname}`,
    fetchedAt: inventory.inventory.fetchedAt,
  };
}

export function buildAgentTools(ctx: AgentToolContext) {
  let operatorPool: Promise<AgentOperatorPool> | undefined;
  const loadPool = () => operatorPool ??= loadAgentOperatorPool(ctx);
  return {
    ...buildCalculatorTools(
      loadPool,
      (name, input, run) => guarded(ctx.userId, name, input, run),
      () => loadAgentTrainingResources(ctx),
    ),
    ...buildHealthTools(ctx, (name, input, run) => guarded(ctx.userId, name, input, run)),
    diagnose_account: tool({
      description:
        "账号诊断：查看当前用户的森空岛绑定状态、干员池概览（总数、精二数、稀有度分布、精二六星名单）、当前游戏内基建布局、最近保存的排班。可通过 operators 精确查询指定干员的 own/elite/level；示例池个人状态为未知。判断个人持有与练度时使用。",
      inputSchema: z.object({ operators: z.array(z.string().min(1)).max(30).optional().describe("需要核对的干员规范名或 id") }).strict(),
      execute: async (input) => guarded(ctx.userId, "diagnose_account", input, async () => {
        let skland: Awaited<ReturnType<typeof loadSklandSnapshot>> | null = null;
        let sklandError: string | null = null;
        try {
          skland = await loadSklandSnapshot(ctx);
        } catch (error) {
          sklandError = error instanceof Error ? error.message : "森空岛数据不可用。";
        }
        let savedPlans: Array<{ title: string; createdAt: string; layoutLabel: string | null }> = [];
        try {
          const plans = await listSavedPlans(ctx.userId);
          savedPlans = plans.plans.slice(0, 3).map((plan) => ({
            title: plan.title,
            createdAt: plan.createdAt,
            layoutLabel: plan.calculationContext?.presetLabel ?? null,
          }));
        } catch {
          savedPlans = [];
        }
        const pool = await loadPool();
        return {
          operators: inspectAgentOperators(pool, input.operators ?? []),
          operatorPool: { source: pool.source, sourceName: pool.sourceName, isSample: pool.source === "sample", ...operboxStats(pool.operbox) },
          skland: skland
            ? {
                connected: true,
                player: skland.player,
                operbox: operboxStats(skland.operbox),
                currentInfrastructure: skland.infrastructure,
                warnings: skland.warnings,
              }
            : { connected: false, reason: sklandError },
          savedPlans,
        };
      }),
    }),

    preview_solve_defaults: tool({
      description:
        "排班配置预览：返回简化指令下 solve_schedule 将自动采用的默认配置（布局预设及推断来源、干员来源、换班节奏、菲亚梅塔、按场景的制造配方与贸易订单）。用户说「帮我排个班」「帮我搓玉」「纯产钱」这类没说全布局/换班/菲亚梅塔/产物的请求时，先调用本工具，把配置报给博士确认，确认后再调 solve_schedule。scene 选 orundum（搓玉）或 money（产钱）可预览对应场景默认配方。本工具只读配置，不占求解器算力。",
      inputSchema: z.object({
        scene: z.enum(["balanced", "orundum", "money"]).optional().describe("场景：balanced=常规（默认配方）、orundum=搓玉（仅 243/333/342 默认配齐碎片线+贸易线；153/252 无搓玉默认）、money=纯产钱（全龙门商法+全赤金）。省略为 balanced"),
      }).strict(),
      execute: async (input) => guarded(ctx.userId, "preview_solve_defaults", input, async () => {
        const defaults = await resolveSolveDefaults(ctx);
        const presetLabel = defaults.layoutPreset;
        const preset = PRESETS.find((candidate) => candidate.label === presetLabel);
        const scenario = input.scene ?? "balanced";
        let layout = preset ? buildBlueprint(preset) : null;
        let scenarioNote = "沿用布局默认配方。";
        if (layout) {
          const applied = applyScenario(layout, presetLabel, scenario);
          layout = applied.layout;
          scenarioNote = applied.scenarioNote;
        }
        const factoryRecipes = layout
          ? layout.rooms.filter((room) => room.kind === "factory").map((room) => factoryRecipeFor(room))
          : [];
        const tradeOrders = layout
          ? layout.rooms.filter((room) => room.kind === "trade_post").map((room) => tradeOrderFor(room))
          : [];
        return {
          layoutPreset: presetLabel,
          layoutSource: LAYOUT_SOURCE_LABELS[defaults.layoutSource],
          boxSource: defaults.boxSource,
          boxSourceNote: boxSourceNote(defaults.boxSource),
          rotation: DEFAULT_ROTATION,
          rotationNote: "默认换班节奏 abc_12_12_12（三班 12/12/12 小时，一天两换）",
          fiammettaEnable: false,
          scenario,
          factoryRecipes,
          tradeOrders,
          scenarioNote,
          note: "把以上默认配置报给博士确认；博士要调整哪项就改哪项，确认后再调 solve_schedule。",
        };
      }),
    }),

    solve_schedule: tool({
      toModelOutput: ({ output }) => {
        const projection = { ...(output as Record<string, unknown>) };
        delete projection.workbenchSession;
        return { type: "text", value: JSON.stringify(projection) };
      },
      description:
        "排班求解：向站内求解器提交一次真正的排班计算，返回三班（或所选节奏）排班表、日产出与练卡建议。用户已给全配置、或已通过 preview_solve_defaults 报默认配置并经博士确认后调用；省略的参数服务端自动兜底（布局从游戏内基建/历史排班推断，干员按森空岛→MAA 上传→示例 Box 三级降级）。搓玉请求用 scene=orundum（仅 243/333/342 布局默认配齐碎片线＋贸易线；153/252 无搓玉默认配置，沿用布局默认配方，需搓玉时必须显式传 manufactureRecipes/tradeOrders），纯产钱用 scene=money（全龙门商法+全赤金），其余情况无需手写 manufactureRecipes/tradeOrders。计算耗时通常 2-3 秒。本工具只做计算，不做知识检索；机制解释类问题用 kb_route。",
      inputSchema: z.object({
        layoutPreset: z.enum(["243", "153", "333", "252", "342"]).optional().describe("布局预设：贸易/制造/发电站数量。省略则自动推断（游戏内布局 → 最近排班 → 默认 243）"),
        boxSource: z.enum(["skland", "maa", "sample"]).optional().describe("干员数据来源：skland=用户森空岛同步，maa=最近上传的 MAA 文件，sample=243 全精二示例。省略则按森空岛 → MAA → 示例 Box 三级降级"),
        scene: z.enum(["balanced", "orundum", "money"]).optional().describe("场景默认配方：balanced=常规（沿用布局默认配方）、orundum=搓玉（仅 243/333/342 默认配齐碎片线+贸易线两条；153/252 无搓玉默认，沿用布局默认配方且不含碎片线）、money=纯产钱（全贸易站龙门商法+全制造站赤金）。用户提到搓玉/合成玉必选 orundum；提到纯产钱/产龙门币必选 money。省略为 balanced"),
        rotation: z.enum(["abc_12_6_6", "abc_12_12_12", "main_backup_12_12"]).optional().describe(
          "换班节奏：abc_12_12_12=一天两换（三班 12/12/12 小时，默认）、abc_12_6_6=一天三换（三班 12/6/6 小时）、main_backup_12_12=主备轮换（两班 12/12 小时）。省略为 abc_12_12_12"
        ),
        manufactureRecipes: z.array(z.enum(["gold", "battle_record", "originium"])).optional().describe(
          "制造站配方，按制造站顺序给定：gold=贵金属（产赤金）、battle_record=作战记录（产经验）、originium=源石碎片（搓玉用）。省略时按场景取默认：balanced 沿用布局默认配方（243 为 2 赤金＋2 作战记录）、money 全部产赤金、orundum 仅 243/333/342 有搓玉默认（依次为 2 赤金＋1 作战记录＋1 源石碎片、2 赤金＋1 源石碎片、3 赤金＋1 源石碎片；153/252 沿用布局默认配方、不含碎片线，需搓玉时必须显式传入）。"
        ),
        tradeOrders: z.array(z.enum(["gold", "originium"])).optional().describe(
          "贸易站订单，按贸易站顺序给定：gold=龙门商法（订单产龙门币）、originium=开采协力（提交源石碎片换合成玉）。搓玉必须至少一座贸易站设为 originium，否则碎片换不成玉。243 布局示例：[\"originium\",\"gold\"]。注意 Lv.3 贸易站才能用开采协力；等级不足 3 的贸易站会保持原订单且不报错，调用后需核对返回的 tradeOrders 确认已生效。省略则按场景或预设。"
        ),
        fiammettaEnable: z.boolean().optional().describe("是否启用菲亚梅塔换班加成，默认 false"),
      }),
      execute: async (input) => guarded(ctx.userId, "solve_schedule", input, async () => {
        const defaults = await resolveSolveDefaults(ctx);
        const presetLabel = input.layoutPreset ?? defaults.layoutPreset;
        const preset = PRESETS.find((candidate) => candidate.label === presetLabel);
        if (!preset) return { error: `未知布局预设：${presetLabel}` };
        let layout: BaseBlueprint = buildBlueprint(preset);
        const scenario = input.scene ?? "balanced";
          const applied = applyScenario(layout, presetLabel, scenario);
        layout = applied.layout;
        if (input.manufactureRecipes?.length) {
          const factoryRooms = layout.rooms.filter((room) => room.kind === "factory");
          for (const [index, recipe] of input.manufactureRecipes.entries()) {
            const room = factoryRooms[index];
            if (room) layout = updateFactoryRecipe(layout, room.id, recipe as FactoryRecipe);
          }
        }
        if (input.tradeOrders?.length) {
          const tradeRooms = layout.rooms.filter((room) => room.kind === "trade_post");
          for (const [index, order] of input.tradeOrders.entries()) {
            const room = tradeRooms[index];
            if (room) layout = updateTradeOrder(layout, room.id, order as TradeOrder);
          }
        }
        const recipes = layout.rooms
          .filter((room) => room.kind === "factory")
          .map((room) => factoryRecipeFor(room));
        const tradeOrders = layout.rooms
          .filter((room) => room.kind === "trade_post")
          .map((room) => tradeOrderFor(room));
        const boxSource = input.boxSource ?? defaults.boxSource;
        let operbox: OperBoxEntry[];
        let sourceName: string;
        let dataOwnerTag: string | null = null;
        if (boxSource === "skland") {
          const snapshot = await loadSklandSnapshot(ctx);
          operbox = snapshot.operbox;
          sourceName = snapshot.sourceName;
          dataOwnerTag = snapshot.dataOwnerTag;
        } else if (boxSource === "maa") {
          const maa = await getMaaOperboxSnapshot(ctx.userId);
          if (!maa || maa.length === 0) {
            return { error: "没有可用的 MAA 上传数据。请先在工作台上传 MAA 干员文件，或改用 skland / sample 来源。" };
          }
          operbox = maa;
          sourceName = "MAA 上传";
        } else {
          const sample = await getSampleOperbox();
          operbox = sample.operbox as OperBoxEntry[];
          sourceName = sample.sourceName;
        }
        // 求解器是首个计费工具：参数已经通过 schema 与布局/干员来源校验后再扣费，
        // 避免用户因为格式错误消耗积分；后续 token 计量会在 agent stream 收尾时补写。
        const runId = randomUUID();
        const billing = ctx.gatewayBilling ? null : await chargeAgentTool({
          userId: ctx.userId,
          toolName: "solve_schedule",
          points: SOLVE_TOOL_POINTS,
          idempotencyKey: `solve_schedule:${runId}`,
          runId,
        });
        const rotation = (input.rotation && ROTATION_PROFILES.includes(input.rotation) ? input.rotation : DEFAULT_ROTATION);
        const runResult = await withTimeout(
          runPlan({
            layout,
            operbox,
            sourceName,
            rotation,
            fiammettaEnable: input.fiammettaEnable ?? false,
            dataOwnerTag,
          }),
          SOLVE_TIMEOUT_MS,
          `求解超时（${SOLVE_TIMEOUT_MS / 1000} 秒），请稍后重试或改用示例 Box。`
        );
        const publicResult = toPublicPlanData(
          runResult,
          { layoutLabel: preset.label, sourceName, layout },
          createRequestId()
        );
        const projected = projectPlanResult(publicResult);
        const workbenchSession = {
          presetLabel: preset.label,
          layout,
          operbox,
          sourceName,
          boxSource,
          rotationProfile: rotation,
          fiammettaEnabled: input.fiammettaEnable ?? false,
          result: publicResult,
          activeShift: 0,
        };
        return {
          solved: true,
          defaultsApplied: {
            layoutPreset: preset.label,
            layoutSource: LAYOUT_SOURCE_LABELS[defaults.layoutSource],
            boxSource,
            boxSourceNote: boxSourceNote(boxSource),
            rotation,
            rotationNote: rotation === DEFAULT_ROTATION ? "abc_12_12_12（三班 12/12/12 小时，一天两换）" : null,
            scenario,
            scenarioNote: applied.scenarioNote,
          },
          factoryRecipes: recipes,
          tradeOrders,
          boxSource,
          operatorCount: operbox.length,
          billing: billing ? { pointsCharged: billing.charged, usageId: billing.usageId, remainingPoints: billing.wallet.totalPoints } : { pendingSettlement: true },
          workbenchSession,
          plan: projected,
        };
      }),
    }),

    query_skills: tool({
      description: "基建技能查询：按干员名或 id、技能名、关键词或标签查询技能所属干员、游戏基建技能原文、标签与解锁练度；不判断用户个人是否持有。返回后固定用 kb_route 定位隐性释义并 kb_read 阅读相关正文；组合用法按需继续读取。",
      inputSchema: z.object({
        query: z.string().min(1).describe("干员名或 id、技能名或效果关键词，如 孑 订单效率 赤金 生产力"),
        tag: z.string().optional().describe("可选标签过滤，如 生产力 订单效率 心情消耗"),
        limit: z.number().int().min(1).max(30).optional().describe("返回条数上限，默认 12"),
      }),
      execute: async (input) => guarded(ctx.userId, "query_skills", input, async () => {
        return queryAgentSkills(input);
      }),
    }),

    load_agent_skill: tool({
      description: "按 id 加载已启用任务指引；可按复杂请求自主组合，简单排班/专精/公招无需加载。指引是取证流程，不是事实来源。",
      inputSchema: z.object({ id: z.string().min(1) }).strict(),
      execute: async (input) => guarded(ctx.userId, "load_agent_skill", input, async () => ctx.resources ? resourceSkill(ctx.resources, input.id) : readAgentSkill(agentKnowledgeDir(), input.id)),
    }),

    kb_route: tool({
      description:
        "知识库导诊：把用户问题转成关键词，返回基建知识库（RIIC-knowledge）中最相关的候选文档路径列表。用于机制解释、数值出处、版本结论、搓玉取舍等知识性内容。技能类问题先查 query_skills 拿效果原文；所有技能问题都用本工具定位隐性释义并 kb_read 阅读相关正文；用法与组合按需继续读。成功检索无特殊释义时正常按原文回答，不汇报检索过程。排班求解、账号诊断等纯操作请求不经过本工具。",
      inputSchema: z.object({
        question: z.string().min(1).describe("用户的问题或主题关键词，如 搓玉 源石碎片 无人机折算"),
      }),
      execute: async (input) => guarded(ctx.userId, "kb_route", input, async () => searchKnowledgeBase(input.question, ctx.resources)),
    }),

    kb_read: tool({
      description: "读取知识库文档正文（markdown）。path 使用 kb_route、已加载任务指引或已读正文引用的 docs 相对路径；超长文档返回 nextOffset，可用 offset 继续读取，避免遗漏后续条件。",
      inputSchema: z.object({
        path: z.string().min(1).describe("知识库内相对路径，如 docs/1-基础设定/资源体系/产出常数表.md"),
        offset: z.number().int().min(0).optional().describe("续读时使用上次 nextOffset"),
      }),
      execute: async (input) => guarded(ctx.userId, "kb_read", input, async () => readKnowledgeDoc(input.path, input.offset, ctx.resources)),
    }),
  };
}
