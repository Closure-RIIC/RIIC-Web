import type {
  TrainingAdviceAcquisition,
  TrainingAdviceAction,
  TrainingAdviceCombinationState,
  TrainingAdviceCondition,
  TrainingAdviceConditionEvaluation,
  TrainingAdviceContext,
  TrainingAdviceEfficiency,
  TrainingAdviceJsonValue,
  TrainingAdviceMember,
  TrainingAdviceMemberProgress,
  TrainingAdviceMemberRole,
  TrainingAdviceNewbieSectionStatus,
  TrainingAdvicePriority,
  TrainingAdviceProduct,
  TrainingAdviceReason,
  TrainingAdviceReport,
  TrainingAdviceState,
  TrainingAdviceTarget,
  TrainingCombination,
  TrainingNewbieItem,
  TrainingRecommendation,
} from "./types";

type RecordValue = Record<string, unknown>;

const INTERNAL_VALUE_KEYS = new Set([
  "candidates",
  "clipath",
  "command",
  "coreroot",
  "datadir",
  "debug",
  "debugbundle",
  "feedbackroot",
  "fixturepath",
  "pid",
  "plan_contract_sha256",
  "reporoot",
  "resultpath",
  "runpath",
  "serverrequest",
  "serverresponse",
  "solver",
  "solver_executable_sha256",
  "stderr",
  "stdout",
  "storageroot",
]);

const NEWBIE_STATUSES = ["shown", "complete", "skipped_by_efficiency"] as const;
const ACTIONS = ["acquire", "train"] as const;
const PRODUCTS = ["trade", "gold", "experience", "general_manufacturing", "originium_shards"] as const;
const TARGET_KINDS = ["explicit", "no_requirement", "derive_from_skill_binding", "needs_review"] as const;
const ACQUISITION_KINDS = ["shop", "public_recruitment", "event", "redeem_code", "integrated_strategy"] as const;
const CONDITION_KINDS = ["layout", "facility", "same_station", "dormitory", "engineering_robots", "custom"] as const;
const CONDITION_STATUSES = ["satisfied", "unsatisfied", "unknown"] as const;
const COMBINATION_STATES = ["complete", "needs_training", "missing_core", "missing_important", "needs_review"] as const;
const MEMBER_ROLES = ["core", "important", "secondary", "hanger"] as const;
const MEMBER_PROGRESS = ["missing", "owned_needs_training", "ready", "needs_review"] as const;
const COMBINATION_TIERS = ["high_efficiency", "low_efficiency"] as const;
const COMBINATION_SCALES = ["small", "system"] as const;
const PRIORITIES = [
  "newbie_four_star_elite_one",
  "flagship_newbie",
  "other_newbie",
  "owned_tailor",
  "automation_must_train",
  "small_high_efficiency_core",
  "small_high_efficiency_important",
  "system_single_core_gap",
  "other_important",
  "lower_priority_core",
  "high_efficiency_standalone",
] as const;
const REASONS = ["newbie_required", "combination_core", "combination_important", "standalone"] as const;
const EFFICIENCY_UNITS = ["order_percent", "production_percent"] as const;

function record(value: unknown, path: string): RecordValue {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} 必须是对象。`);
  }
  return value as RecordValue;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Error(`${path} 必须是字符串。`);
  return value;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} 必须是布尔值。`);
  return value;
}

function numberValue(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} 必须是有限数字。`);
  return value;
}

function integerValue(value: unknown, path: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const parsed = numberValue(value, path);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${path} 必须是 ${min} 至 ${max} 的整数。`);
  }
  return parsed;
}

function enumValue<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  path: string,
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new Error(`${path} 包含不支持的枚举值。`);
  }
  return value as Values[number];
}

function arrayValue<T>(value: unknown, path: string, parser: (item: unknown, path: string) => T): T[] {
  if (!Array.isArray(value)) throw new Error(`${path} 必须是数组。`);
  return value.map((item, index) => parser(item, `${path}[${index}]`));
}

function optional<T>(source: RecordValue, key: string, parser: (value: unknown, path: string) => T, path: string): T | undefined {
  const value = source[key];
  if (value === undefined || value === null) return undefined;
  return parser(value, `${path}.${key}`);
}

function stringArray(value: unknown, path: string): string[] {
  return arrayValue(value, path, stringValue);
}

function jsonValue(value: unknown, path: string): TrainingAdviceJsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return numberValue(value, path);
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${path}[${index}]`));
  const source = record(value, path);
  return Object.fromEntries(
    Object.entries(source)
      .filter(([key]) => !INTERNAL_VALUE_KEYS.has(key.toLowerCase()))
      .map(([key, child]) => [key, jsonValue(child, `${path}.${key}`)]),
  );
}

function state(value: unknown, path: string): TrainingAdviceState {
  const source = record(value, path);
  const level = optional(source, "level", integerValue, path);
  return {
    elite: integerValue(source.elite, `${path}.elite`, 0, 2),
    ...(level !== undefined ? { level } : {}),
  };
}

function target(value: unknown, path: string): TrainingAdviceTarget {
  const source = record(value, path);
  const elite = optional(source, "elite", (item, itemPath) => integerValue(item, itemPath, 0, 2), path);
  const level = optional(source, "level", integerValue, path);
  return {
    kind: enumValue(source.kind, TARGET_KINDS, `${path}.kind`),
    ...(elite !== undefined ? { elite } : {}),
    ...(level !== undefined ? { level } : {}),
  };
}

function acquisition(value: unknown, path: string): TrainingAdviceAcquisition {
  const source = record(value, path);
  return {
    kind: enumValue(source.kind, ACQUISITION_KINDS, `${path}.kind`),
    detail: stringValue(source.detail, `${path}.detail`),
  };
}

function condition(value: unknown, path: string): TrainingAdviceCondition {
  const source = record(value, path);
  const parsedValue = optional(source, "value", jsonValue, path);
  return {
    kind: enumValue(source.kind, CONDITION_KINDS, `${path}.kind`),
    key: stringValue(source.key, `${path}.key`),
    ...(parsedValue !== undefined ? { value: parsedValue } : {}),
    description: stringValue(source.description, `${path}.description`),
  };
}

function conditionEvaluation(value: unknown, path: string): TrainingAdviceConditionEvaluation {
  const source = record(value, path);
  return {
    condition: condition(source.condition, `${path}.condition`),
    status: enumValue(source.status, CONDITION_STATUSES, `${path}.status`),
  };
}

function efficiency(value: unknown, path: string): TrainingAdviceEfficiency {
  const source = record(value, path);
  const note = optional(source, "note", stringValue, path);
  return {
    value: numberValue(source.value, `${path}.value`),
    unit: enumValue(source.unit, EFFICIENCY_UNITS, `${path}.unit`),
    ...(note !== undefined ? { note } : {}),
  };
}

function member(value: unknown, path: string): TrainingAdviceMember {
  const source = record(value, path);
  const current = optional(source, "current", state, path);
  return {
    operator: stringValue(source.operator, `${path}.operator`),
    role: enumValue(source.role, MEMBER_ROLES, `${path}.role`) as TrainingAdviceMemberRole,
    progress: enumValue(source.progress, MEMBER_PROGRESS, `${path}.progress`) as TrainingAdviceMemberProgress,
    owned: booleanValue(source.owned, `${path}.owned`),
    target_met: booleanValue(source.target_met, `${path}.target_met`),
    ...(current !== undefined ? { current } : {}),
    target: target(source.target, `${path}.target`),
    counts_toward_completion: booleanValue(source.counts_toward_completion, `${path}.counts_toward_completion`),
  };
}

function combination(value: unknown, path: string): TrainingCombination {
  const source = record(value, path);
  const product = optional(source, "product", (item, itemPath) => enumValue(item, PRODUCTS, itemPath), path);
  const consumerProducts = optional(
    source,
    "consumer_products",
    (item, itemPath) => arrayValue(item, itemPath, (productValue, productPath) => enumValue(productValue, PRODUCTS, productPath)),
    path,
  );
  const tier = optional(source, "tier", (item, itemPath) => enumValue(item, COMBINATION_TIERS, itemPath), path);
  const selectedAlternative = optional(source, "selected_alternative", integerValue, path);
  const missingCore = optional(source, "missing_core", stringArray, path);
  const untrainedCore = optional(source, "untrained_core", stringArray, path);
  const missingImportant = optional(source, "missing_important", stringArray, path);
  const untrainedImportant = optional(source, "untrained_important", stringArray, path);
  return {
    id: stringValue(source.id, `${path}.id`),
    name: stringValue(source.name, `${path}.name`),
    ...(product !== undefined ? { product: product as TrainingAdviceProduct } : {}),
    ...(consumerProducts !== undefined ? { consumer_products: consumerProducts as TrainingAdviceProduct[] } : {}),
    ...(tier !== undefined ? { tier } : {}),
    scale: enumValue(source.scale, COMBINATION_SCALES, `${path}.scale`),
    facilities: stringArray(source.facilities, `${path}.facilities`),
    state: enumValue(source.state, COMBINATION_STATES, `${path}.state`) as TrainingAdviceCombinationState,
    completed_slots: integerValue(source.completed_slots, `${path}.completed_slots`),
    total_slots: integerValue(source.total_slots, `${path}.total_slots`),
    completion_percent: integerValue(source.completion_percent, `${path}.completion_percent`, 0, 100),
    ...(missingCore !== undefined ? { missing_core: missingCore } : {}),
    ...(untrainedCore !== undefined ? { untrained_core: untrainedCore } : {}),
    ...(missingImportant !== undefined ? { missing_important: missingImportant } : {}),
    ...(untrainedImportant !== undefined ? { untrained_important: untrainedImportant } : {}),
    ...(selectedAlternative !== undefined ? { selected_alternative: selectedAlternative } : {}),
    members: arrayValue(source.members, `${path}.members`, member),
  };
}

function newbieItem(value: unknown, path: string): TrainingNewbieItem {
  const source = record(value, path);
  const current = optional(source, "current", state, path);
  const parsedAcquisition = optional(source, "acquisition", acquisition, path);
  return {
    operator: stringValue(source.operator, `${path}.operator`),
    product: enumValue(source.product, PRODUCTS, `${path}.product`) as TrainingAdviceProduct,
    action: enumValue(source.action, ACTIONS, `${path}.action`) as TrainingAdviceAction,
    ...(current !== undefined ? { current } : {}),
    target: target(source.target, `${path}.target`),
    ...(parsedAcquisition !== undefined ? { acquisition: parsedAcquisition } : {}),
  };
}

function recommendation(value: unknown, path: string): TrainingRecommendation {
  const source = record(value, path);
  const current = optional(source, "current", state, path);
  const product = optional(source, "product", (item, itemPath) => enumValue(item, PRODUCTS, itemPath), path);
  const combinationId = optional(source, "combination_id", stringValue, path);
  const combinationName = optional(source, "combination_name", stringValue, path);
  const parsedEfficiency = optional(source, "efficiency", efficiency, path);
  const conditions = optional(source, "conditions", (item, itemPath) => arrayValue(item, itemPath, conditionEvaluation), path);
  const parsedAcquisition = optional(source, "acquisition", acquisition, path);
  return {
    operator: stringValue(source.operator, `${path}.operator`),
    action: enumValue(source.action, ACTIONS, `${path}.action`) as TrainingAdviceAction,
    ...(current !== undefined ? { current } : {}),
    target: target(source.target, `${path}.target`),
    priority: enumValue(source.priority, PRIORITIES, `${path}.priority`) as TrainingAdvicePriority,
    priority_rank: integerValue(source.priority_rank, `${path}.priority_rank`, 0, 65_535),
    reason: enumValue(source.reason, REASONS, `${path}.reason`) as TrainingAdviceReason,
    ...(product !== undefined ? { product: product as TrainingAdviceProduct } : {}),
    ...(combinationId !== undefined ? { combination_id: combinationId } : {}),
    ...(combinationName !== undefined ? { combination_name: combinationName } : {}),
    ...(parsedEfficiency !== undefined ? { efficiency: parsedEfficiency } : {}),
    ...(conditions !== undefined ? { conditions } : {}),
    ...(parsedAcquisition !== undefined ? { acquisition: parsedAcquisition } : {}),
  };
}

function context(value: unknown, path: string): TrainingAdviceContext {
  const source = record(value, path);
  const optionalInteger = (key: string) => optional(source, key, integerValue, path);
  const optionalNumber = (key: string) => optional(source, key, numberValue, path);
  const optionalBoolean = (key: string) => optional(source, key, booleanValue, path);
  const dormitoryLevelSum = optionalInteger("dormitory_level_sum");
  const engineeringRobotCount = optionalInteger("engineering_robot_count");
  const hasOriginiumShardFactory = optionalBoolean("has_originium_shard_factory");
  const manufacturingAverage = optionalNumber("manufacturing_average_efficiency_percent");
  const meetingRoomMaxLevel = optionalInteger("meeting_room_max_level");
  const tradeAverage = optionalNumber("trade_average_efficiency_percent");
  return {
    ...(dormitoryLevelSum !== undefined ? { dormitory_level_sum: dormitoryLevelSum } : {}),
    ...(engineeringRobotCount !== undefined ? { engineering_robot_count: engineeringRobotCount } : {}),
    ...(hasOriginiumShardFactory !== undefined ? { has_originium_shard_factory: hasOriginiumShardFactory } : {}),
    ...(manufacturingAverage !== undefined ? { manufacturing_average_efficiency_percent: manufacturingAverage } : {}),
    ...(meetingRoomMaxLevel !== undefined ? { meeting_room_max_level: meetingRoomMaxLevel } : {}),
    ...(tradeAverage !== undefined ? { trade_average_efficiency_percent: tradeAverage } : {}),
  };
}

export function parseTrainingAdviceReport(value: unknown, path = "training_advice"): TrainingAdviceReport {
  const source = record(value, path);
  if (source.schema_version !== 2) throw new Error(`${path}.schema_version 必须为 2。`);
  const recommendations = arrayValue(source.recommendations, `${path}.recommendations`, recommendation);
  if (recommendations.length > 10) throw new Error(`${path}.recommendations 不能超过 10 项。`);
  return {
    schema_version: 2,
    context: context(source.context, `${path}.context`),
    newbie_section_status: enumValue(
      source.newbie_section_status,
      NEWBIE_STATUSES,
      `${path}.newbie_section_status`,
    ) as TrainingAdviceNewbieSectionStatus,
    incomplete_newbie: arrayValue(source.incomplete_newbie, `${path}.incomplete_newbie`, newbieItem),
    combinations: arrayValue(source.combinations, `${path}.combinations`, combination),
    recommendations,
  };
}
