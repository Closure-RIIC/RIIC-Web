import { tool } from "ai";
import { z } from "zod";
import { calculateMastery, formatMasteryTime, MASTERY_ENVIRONMENTS } from "../../mastery.ts";
import { inspectMasteryTarget, resolveAgentOperator } from "./operator-tools.ts";
import { masteryInstructions } from "../../mastery-presentation.ts";
import { calculateRecruitment, RECRUITMENT_TAGS, RECRUITMENT_SOURCE } from "../../recruitment.ts";
import type { MasteryEnvironmentObservation } from "./mastery-environment.ts";
import type { OperBoxEntry, SklandInventoryItem, SklandOperatorStatus } from "../../types.ts";
import { OPERATOR_CATALOG } from "../../operatorPortraits.ts";
import { manualLevelFor, maxEliteForRarity } from "../../manual-operbox.ts";
import { calculateTrainingPlan, defaultTrainingGoal, type TrainingPlannerData } from "../../training-planner.ts";
import trainingPlannerDataJson from "../../generated/training-planner-data.json" with { type: "json" };

export interface AgentOperatorPool {
  operbox: OperBoxEntry[];
  source: "skland" | "maa" | "sample";
  sourceName: string;
  masteryEnvironment?: MasteryEnvironmentObservation;
}

type Guard = <T>(name: string, input: unknown, run: () => Promise<T>) => Promise<T | { error: string }>;

export interface AgentTrainingResources {
  operators: SklandOperatorStatus[];
  inventory: SklandInventoryItem[];
  sourceName: string;
  fetchedAt: string;
}

const TRAINING_DATA = trainingPlannerDataJson as TrainingPlannerData;
const TRAINING_OPERATOR_BY_ID = new Map(OPERATOR_CATALOG.map((operator) => [operator.id, operator]));
const EXPERIENCE_BOOKS = [
  { id: "2001", name: "初级作战记录", experience: 200 },
  { id: "2002", name: "中级作战记录", experience: 400 },
  { id: "2003", name: "高级作战记录", experience: 1_000 },
  { id: "2004", name: "特级作战记录", experience: 2_000 },
] as const;

export function buildCalculatorTools(
  loadPool: () => Promise<AgentOperatorPool>,
  guard: Guard,
  loadTrainingResources?: () => Promise<AgentTrainingResources>,
) {
  return {
    resolve_operator: tool({
      description: "轻量查询站内干员身份和专精资格，复用目录、干员别名及当前干员池，不查询技能机制。目标等级尚不明确时先用它核实身份；等级已明确可直接 calculate_mastery。歧义返回候选供用户选择，示例池不代表个人持有。",
      inputSchema: z.object({ query: z.string().trim().min(1) }).strict(),
      execute: async (input) => guard("resolve_operator", input, async () => inspectMasteryTarget(await loadPool(), input.query)),
    }),
    calculate_mastery: tool({
      description: "专精训练计算：按当前账号干员池生成简单、快速两套教官与换人时间线，无需基建排班。干员池自动按森空岛→MAA→全精二示例兜底。targetOperator 可传用户给出的名称、简称或 ID，由工具查站内目录和现有别名；目标未持有、持有未知或未精二时仍按已获得且精二的前提计算，成功结果附带警告；教官按原始干员池的持有与练度筛选。歧义时返回候选供用户选择。未指定中枢与环境参数时自动读取森空岛快照；无快照中枢默认 +5%、环境默认 0，换人余量默认 1 分钟；环境值为实际进驻人数或对应点数。",
      inputSchema: z.object({
        targetOperator: z.string().trim().min(1).describe("目标干员名称、简称或 ID；由工具解析，多候选时请用户选择"),
        current: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional().describe("当前专精等级，省略从未专精（0）开始；用户说从专X开始时传 X"),
        target: z.union([z.literal(1), z.literal(2), z.literal(3)]).describe("目标专精等级，必须高于当前等级"),
        controlBonus: z.boolean().optional().describe("用户明确指定的中枢加成；省略自动读取，无快照默认开启"),
        bufferMinutes: z.number().min(0).max(1440).optional().describe("减半教官换人操作余量（分钟），默认 1"),
        environment: z.object(Object.fromEntries(Object.entries(MASTERY_ENVIRONMENTS).map(([key, config]) => [
          key, z.number().int().min(0).max(config.max ?? 10000).optional().describe(config.label),
        ]))).strict().optional().describe("仅传用户明确指定的环境参数；其余自动读取，未支持或无快照时为 0"),
      }).strict(),
      execute: async (input) => guard("calculate_mastery", input, async () => {
        const pool = await loadPool();
        const identity = await inspectMasteryTarget(pool, input.targetOperator);
        if ("error" in identity) return identity;
        const target = identity.operator;
        const settings = {
          current: input.current ?? 0, target: input.target,
          controlBonus: input.controlBonus ?? pool.masteryEnvironment?.controlBonus ?? true, bufferMinutes: input.bufferMinutes ?? 1,
          environment: Object.fromEntries(Object.keys(MASTERY_ENVIRONMENTS).map((key) => [key, input.environment?.[key] ?? pool.masteryEnvironment?.environment[key] ?? 0])),
        };
        const result = calculateMastery({ operbox: pool.operbox, targetId: target.id, ...settings });
        const project = (plan: typeof result.simple) => ({
          ...plan, totalTime: formatMasteryTime(plan.totalSeconds), instructions: masteryInstructions(plan),
        });
        return {
          source: pool.source, sourceName: pool.sourceName, isSample: pool.source === "sample",
          targetOperator: { id: target.id, name: target.name }, settings,
          targetStatus: { ownershipKnown: identity.ownershipKnown, own: identity.own, elite: identity.elite },
          warnings: identity.warnings, targetAssumptions: identity.targetAssumptions,
          environmentObservation: pool.masteryEnvironment ?? null,
          settingsSources: {
            controlBonus: input.controlBonus !== undefined ? "手动指定" : pool.masteryEnvironment ? "森空岛自动读取" : "默认值",
            environment: Object.fromEntries(Object.keys(MASTERY_ENVIRONMENTS).map((key) => [key, input.environment?.[key] !== undefined ? "手动指定" : pool.masteryEnvironment?.environment[key] !== undefined ? "森空岛自动读取" : "默认值"])),
          },
          simple: project(result.simple), fast: project(result.fast),
          savedSeconds: Math.max(0, result.simple.totalSeconds - result.fast.totalSeconds),
          assumptions: "按目标干员已获得且达到精二、教官心情充足、材料齐备、训练室等级满足要求计算；教官持有与练度采用所标明来源的原始干员池。环境加成需全程保持；暂不计算休息、武道秒专一和基建产能影响。",
        };
      }),
    }),
    calculate_training: tool({
      description: "干员养成资源计算：用户说出干员和目标精英阶段、等级后直接计算升级所需龙门币、经验、作战记录、晋升材料、仓库库存和缺口；森空岛数据自动作为当前练度和库存。可选传 targetSkillLevel、targetMasteries、targetModules 追加技能等级、专精、模组目标。名称有歧义时返回候选。库存或森空岛读取失败时说明原因，不将未知库存当作零。",
      inputSchema: z.object({
        operator: z.string().trim().min(1).describe("干员名称、别名或 ID"),
        targetElite: z.number().int().min(0).max(2).describe("目标精英阶段，0/1/2"),
        targetLevel: z.number().int().min(1).max(90).describe("目标等级"),
        targetSkillLevel: z.number().int().min(1).max(7).optional().describe("可选目标技能等级，1-7"),
        targetMasteries: z.array(z.object({
          skill: z.number().int().min(1).max(3).describe("第几个技能"),
          level: z.number().int().min(0).max(3).describe("目标专精等级，0-3"),
        }).strict()).max(3).optional().describe("可选各技能目标专精，例如 [{skill: 3, level: 3}]"),
        targetModules: z.array(z.object({
          module: z.string().trim().min(1).describe("模组名称或模组 ID"),
          level: z.number().int().min(1).max(3).describe("目标模组等级，1-3"),
        }).strict()).max(12).optional().describe("可选模组目标，例如 [{module: '模组名', level: 3}]"),
      }).strict(),
      execute: async (input) => guard("calculate_training", input, async () => {
        const resolution = await resolveAgentOperator(input.operator);
        if (resolution.status !== "resolved") {
          const candidates = resolution.candidates.map((operator) => ({ id: operator.id, name: operator.name }));
          if (resolution.status === "unknown") return { error: `站内目录未识别「${input.operator}」，请提供完整干员名或 ID。`, code: "identity_unknown", candidates };
          return { error: `请确认目标干员：${candidates.map((operator) => operator.name).join("、")}。`, code: "identity_ambiguous", candidates };
        }

        const identity = resolution.candidates[0]!;
        const operator = TRAINING_OPERATOR_BY_ID.get(identity.id);
        const trainingData = TRAINING_DATA.operators[identity.id];
        if (!operator || !trainingData) return { error: `「${identity.name}」暂无可用的养成成本数据。`, code: "calculation_unsupported" };
        const maxElite = maxEliteForRarity(operator.rarity);
        if (input.targetElite > maxElite) return { error: `${identity.name}最高可精英化至精${maxElite}。`, code: "invalid_target" };
        const maxLevel = manualLevelFor(operator.rarity, input.targetElite);
        if (input.targetLevel > maxLevel) return { error: `精${input.targetElite}最高等级为 ${maxLevel}。`, code: "invalid_target" };

        if (!loadTrainingResources) return { error: "当前未配置森空岛养成数据读取，无法核对个人库存。", code: "inventory_unavailable" };
        const resources = await loadTrainingResources();
        const status = resources.operators.find((entry) => entry.id === identity.id);
        const current = defaultTrainingGoal(
          { id: identity.id, rarity: operator.rarity },
          status ? { elite: status.elite, level: status.level, own: true } : { elite: 0, level: 1, own: false },
          status,
          trainingData.skills,
          trainingData.modules,
        );
        if (input.targetElite < current.currentElite
          || input.targetElite === current.currentElite && input.targetLevel < current.currentLevel) {
          return { error: `${identity.name}当前为精${current.currentElite} ${current.currentLevel}级，目标练度不能低于当前练度。`, code: "invalid_target" };
        }

        const goal = { ...current, targetElite: input.targetElite, targetLevel: input.targetLevel };
        if (input.targetSkillLevel !== undefined) {
          const maxSkillLevel = trainingData.skillLevels.length ? trainingData.skillLevels.length + 1 : 1;
          if (input.targetSkillLevel > maxSkillLevel) return { error: `${identity.name}技能等级上限为 ${maxSkillLevel}。`, code: "invalid_target" };
          if (input.targetSkillLevel < current.currentSkillLevel) return { error: `目标技能等级不能低于森空岛当前等级 ${current.currentSkillLevel}。`, code: "invalid_target" };
          goal.targetSkillLevel = input.targetSkillLevel;
        }
        for (const mastery of input.targetMasteries ?? []) {
          const skill = trainingData.skills[mastery.skill - 1];
          if (!skill) return { error: `${identity.name}没有第 ${mastery.skill} 个可计算专精的技能。`, code: "invalid_target" };
          const currentLevel = current.currentMasteries[skill.id] ?? 0;
          if (mastery.level > skill.masteries.length || mastery.level < currentLevel) {
            return { error: `${identity.name}第 ${mastery.skill} 个技能当前专精 ${currentLevel}，目标范围为 ${currentLevel}-${skill.masteries.length}。`, code: "invalid_target" };
          }
          goal.targetMasteries[skill.id] = mastery.level;
        }
        const moduleWarnings: string[] = [];
        for (const requested of input.targetModules ?? []) {
          const query = requested.module.toLocaleLowerCase("zh-CN");
          const matches = trainingData.modules.filter((module) => module.id.toLocaleLowerCase("en-US") === query
            || module.name.toLocaleLowerCase("zh-CN") === query);
          if (matches.length !== 1) {
            return { error: matches.length ? `模组「${requested.module}」不唯一，请使用模组 ID。` : `「${identity.name}」没有名为「${requested.module}」的模组。`, code: "invalid_target" };
          }
          const module = matches[0]!;
          const maxModuleLevel = Math.max(0, ...Object.keys(module.costs).map(Number).filter(Number.isFinite));
          const currentLevel = current.currentModules[module.id] ?? 0;
          if (requested.level > maxModuleLevel || requested.level < currentLevel) {
            return { error: `模组「${module.name}」当前等级为 ${currentLevel}，最高等级为 ${maxModuleLevel}。`, code: "invalid_target" };
          }
          goal.targetModules[module.id] = requested.level;
          if (input.targetElite < 2 || input.targetLevel < module.unlockLevel) {
            moduleWarnings.push(`模组「${module.name}」需精二且达到 ${module.unlockLevel} 级才能解锁。`);
          }
        }

        const inventory = Object.fromEntries(resources.inventory.map((item) => [item.id, item.count]));
        const result = calculateTrainingPlan({
          goals: [goal],
          operators: [{ id: identity.id, rarity: operator.rarity }],
          data: TRAINING_DATA,
          inventory,
        });
        const shortagesById = new Map(result.shortages.map((item) => [item.id, item]));
        const materials = Object.entries(result.requirements).map(([id, required]) => ({
          id,
          name: TRAINING_DATA.items[id]?.name ?? id,
          required,
          stock: inventory[id] ?? 0,
          shortageAfterCrafting: shortagesById.get(id)?.missing ?? 0,
          craftBatches: result.crafts.find((craft) => craft.id === id)?.count ?? 0,
        }));
        return {
          operator: { id: identity.id, name: identity.name, rarity: operator.rarity },
          source: resources.sourceName,
          inventoryFetchedAt: resources.fetchedAt,
          owned: Boolean(status),
          current: {
            elite: current.currentElite,
            level: current.currentLevel,
            skillLevel: current.currentSkillLevel,
            masteries: Object.entries(current.currentMasteries).map(([skillId, level]) => ({ skillId, level })),
            modules: Object.entries(current.currentModules).map(([moduleId, level]) => ({
              moduleId,
              name: trainingData.modules.find((module) => module.id === moduleId)?.name ?? moduleId,
              level,
            })),
          },
          target: {
            elite: goal.targetElite,
            level: goal.targetLevel,
            skillLevel: goal.targetSkillLevel,
            masteries: Object.entries(goal.targetMasteries).map(([skillId, level]) => ({ skillId, level })),
            modules: Object.entries(goal.targetModules).map(([moduleId, level]) => ({ moduleId, level })),
          },
          lmd: {
            required: result.lmd,
            stock: result.lmdStock,
            stockWithGoldBars: result.lmdStockWithGoldBars,
            missing: result.lmdMissing,
          },
          experience: {
            required: result.experience,
            stock: result.experienceStock,
            missing: result.experienceMissing,
            missingBookEquivalent: result.experienceBooksEquivalent,
            books: EXPERIENCE_BOOKS.map((book) => ({ ...book, count: inventory[book.id] ?? 0 })),
          },
          materials,
          crafts: result.crafts,
          materialShortages: result.shortages,
          hasInventoryShortage: result.lmdMissing > 0 || result.experienceMissing > 0 || result.shortages.length > 0,
          warnings: [
            ...(!status ? [`森空岛当前干员池未持有「${identity.name}」，按精0 1级作为起点计算。`] : []),
            ...moduleWarnings,
          ],
          assumptions: "库存取自当前森空岛角色；赤金按每个 500 龙门币计入可兑换余额，经验缺口以 2000 点特级作战记录折算。高阶材料优先使用库存，剩余部分按游戏内加工配方拆解。",
        };
      }),
    }),
    calculate_recruitment: tool({
      description: "公招词条计算：用户附带一至五个词条时直接计算，有几个执行几个，不要求补齐五个；完全没有词条时追问。枚举一至三个词条组合，返回最低星级与候选干员。默认九小时。自动获取干员池，全精二示例仅作兜底，示例不用于判断个人缺失。结果以有效词条全部保留为前提，不代表抽取概率。",
      inputSchema: z.object({
        tags: z.array(z.enum(RECRUITMENT_TAGS.map((tag) => tag.zh))).min(1).max(5).describe("公招界面词条名称"),
        minutes: z.number().int().min(60).max(540).multipleOf(10).optional().describe("招聘分钟数，默认 540"),
        fourStarOnly: z.boolean().optional().describe("仅显示最低四星的组合"),
        missingOnly: z.boolean().optional().describe("仅显示包含未拥有干员的组合；示例池时不启用"),
      }).strict(),
      execute: async (input) => guard("calculate_recruitment", input, async () => {
        const pool = await loadPool();
        const minutes = input.minutes ?? 540;
        const tags = [...new Set(input.tags)].map((name) => RECRUITMENT_TAGS.find((tag) => tag.zh === name)!.id);
        const personalPool = pool.source === "sample" ? null : pool.operbox;
        const results = calculateRecruitment(tags, minutes, personalPool).filter((result) =>
          (!input.fourStarOnly || result.minimumRarity >= 4) && (!input.missingOnly || personalPool === null || (result.missingCount ?? 0) > 0));
        return {
          source: pool.source, sourceName: pool.sourceName, isSample: pool.source === "sample",
          minutes, ownershipKnown: personalPool !== null, missingFilterApplied: !!input.missingOnly && personalPool !== null,
          dataSource: RECRUITMENT_SOURCE,
          assumptions: "最低星级以有效词条全部保留为前提，不代表抽取概率；示例干员池不用于判断个人已拥有或缺失。",
          results: results.map((result) => ({
            tags: result.tags.map((id) => RECRUITMENT_TAGS.find((tag) => tag.id === id)!.zh),
            minimumRarity: result.minimumRarity, missingCount: result.missingCount,
            operators: result.operators.map(({ id, name, rarity, ownership }) => ({ id, name, rarity, ownership })),
          })),
        };
      }),
    }),
  };
}
