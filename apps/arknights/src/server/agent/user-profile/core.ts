/**
 * 用户画像 + 长期记忆的纯逻辑层（无 IO、无领域数值）。
 *
 * 设计来源：arknights-user-memory skill（references/01-profile-schema.md）。三条不可破坏的规则：
 * 1. 硬约束与偏好结构分离：约束决定方案可行性，偏好只影响排序；约束只认用户明说。
 * 2. 自述（statedHits）与行为（inferredHits）分开计数，互斥标签并存时生成待澄清冲突。
 * 3. 事实退休而非删除（supersededAt）；任何效率/成本/收益数字都不进画像。
 */

export const PROFILE_SCHEMA_VERSION = 1;

export const PROFILE_VOCAB = {
  goals: {
    mainline: "主线推进优先",
    event_clear: "活动全勤",
    contingency: "危机合约冲层",
    base_output: "基建产能优先",
    collection: "满练收藏",
    rogue: "集成战略（肉鸽）",
    idle_farm: "低操作收菜",
    social_borrow: "借干员/社交",
  },
  commitment: {
    login_le2: "每天登录 ≤2 次",
    login_3_4: "每天登录 3–4 次",
    login_ge5: "每天登录 ≥5 次",
    no_shift_change: "不接受频繁换班",
    shift_ok: "接受按班换班",
    tool_ok: "接受 MAA 等第三方工具",
    official_only: "只用官方客户端",
    afk_ok: "接受挂机/自动",
    manual_only: "必须手动",
  },
  base: {
    layout_243: "偏好 243 布局",
    layout_252: "偏好 252 布局",
    layout_153: "偏好 153 布局",
    layout_333: "偏好 333 布局",
    layout_342: "偏好 342 布局",
    prod_lmd: "产物取向：龙门币",
    prod_exp: "产物取向：经验",
    prod_orundum: "产物取向：合成玉",
    prod_mixed: "产物混合",
    eff_max: "追求极限产能",
    eff_balanced: "产能与操作平衡",
    eff_lowop: "低操作优先",
    drone_active: "无人机积极加速",
    drone_hoard: "无人机攒着",
    mood_strict: "严格不掉心情",
    train_room_on: "使用训练室",
  },
  roster: {
    raise_meta: "强度优先",
    raise_xp: "XP（喜好）优先",
    raise_collect: "满练收藏",
    raise_base_tool: "只练基建工具人",
    mastery_core: "优先专三核心干员",
    mastery_base: "只专基建相关",
    module_chase: "追模组",
    module_min: "只开必需模组",
    e2_wide: "广精二铺开",
    e2_deep: "深练少数",
  },
  economy: {
    pay_none: "无氪",
    pay_monthly: "月卡",
    pay_big: "大月卡",
    pay_whale: "稳定氪金",
    orundum_gacha: "合成玉用于抽卡",
    orundum_annihilation: "合成玉用于剿灭",
    orundum_hoard: "合成玉囤积",
    potion_daily: "理智药日常使用",
    potion_save: "理智药只在关键节点用",
    originite_use: "接受碎石",
    originite_keep: "绝不碎石",
  },
  interaction: {
    answer_first: "先给结论再给理由",
    data_detail: "要数据与推导",
    explain_why: "要解释为什么这么配",
    push_daily: "接受每日提醒",
    push_weekly: "只要每周复盘",
    passive_only: "只在被问时回答",
    style_brief: "简洁",
    style_verbose: "详细",
  },
} as const;

export type ProfileGroup = keyof typeof PROFILE_VOCAB;
export const PROFILE_GROUPS = Object.keys(PROFILE_VOCAB) as ProfileGroup[];

const TAG_INDEX = new Map<string, { group: ProfileGroup; text: string }>();
for (const group of PROFILE_GROUPS) {
  for (const [id, text] of Object.entries(PROFILE_VOCAB[group])) TAG_INDEX.set(id, { group, text });
}
export const PROFILE_TAG_IDS = [...TAG_INDEX.keys()];
export function profileTagText(id: string): string | null {
  return TAG_INDEX.get(id)?.text ?? null;
}

/** 互斥对：允许共存，但一侧有自述、另一侧行为证据 ≥3 时必须生成冲突记录。每对都在同一组内。 */
export const PROFILE_EXCLUSIVE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["eff_max", "eff_lowop"],
  ["shift_ok", "no_shift_change"],
  ["raise_meta", "raise_xp"],
  ["orundum_gacha", "orundum_hoard"],
  ["tool_ok", "official_only"],
  ["login_le2", "login_ge5"],
  ["afk_ok", "manual_only"],
  ["drone_active", "drone_hoard"],
  ["e2_wide", "e2_deep"],
  ["module_chase", "module_min"],
  ["pay_none", "pay_whale"],
  ["originite_use", "originite_keep"],
  ["potion_daily", "potion_save"],
  ["style_brief", "style_verbose"],
];

type ConstraintRule =
  | { kind: "int"; min: number; max: number; label: string }
  | { kind: "bool"; label: string; yes: string; no: string }
  | { kind: "enum"; values: readonly string[]; label: string };

export const PROFILE_CONSTRAINT_RULES = {
  dailyLoginMax: { kind: "int", min: 1, max: 10, label: "每天最多登录次数" },
  sessionMinutes: { kind: "int", min: 5, max: 120, label: "单次可用分钟数" },
  shiftChangeAllowed: { kind: "bool", label: "换班", yes: "接受换班", no: "不接受换班" },
  thirdPartyToolAllowed: { kind: "bool", label: "第三方工具", yes: "可以使用 MAA 等第三方工具", no: "不使用任何第三方工具" },
  device: { kind: "enum", values: ["pc", "mobile", "both"], label: "设备" },
  sanityPotionAllowed: { kind: "bool", label: "理智药", yes: "可以使用理智药", no: "不使用理智药" },
  droneAllowed: { kind: "bool", label: "无人机", yes: "可以使用无人机加速", no: "不使用无人机加速" },
  mustKeepMood: { kind: "bool", label: "心情", yes: "必须保证不掉心情", no: "允许掉心情" },
} as const satisfies Record<string, ConstraintRule>;

export type ProfileConstraintKey = keyof typeof PROFILE_CONSTRAINT_RULES;
export const PROFILE_CONSTRAINT_KEYS = Object.keys(PROFILE_CONSTRAINT_RULES) as ProfileConstraintKey[];
export type ProfileConstraintValue = number | boolean | string;

export type ProfileEvidence = "stated" | "behavior";

export interface ProfileTag {
  id: string;
  score: number;
  hits: number;
  statedHits: number;
  inferredHits: number;
  at: string;
}

export interface ProfileFact {
  id: string;
  text: string;
  hits: number;
  statedHits: number;
  inferredHits: number;
  at: string;
  lastAt: string;
  supersededAt: string | null;
  supersededBy: string | null;
}

export interface ProfileConflict {
  id: string;
  group: ProfileGroup;
  stated: string;
  behavior: string;
  detectedAt: string;
  askedAt: string | null;
  resolution: ProfileEvidence | null;
  resolvedAt?: string;
}

export interface ProfileViolation {
  at: string;
  reason: string;
  detail: string;
}

export interface UserProfile {
  schemaVersion: number;
  constraints: Partial<Record<ProfileConstraintKey, ProfileConstraintValue>>;
  constraintsUpdatedAt: string | null;
  tags: ProfileTag[];
  facts: ProfileFact[];
  conflicts: ProfileConflict[];
  violations: ProfileViolation[];
  factSeq: number;
  conflictSeq: number;
}

export const PROFILE_LIMITS = {
  groupCap: 6,
  globalCap: 24,
  factCap: 40,
  factMaxLength: 60,
  violationCap: 20,
  decayPerWeek: 0.85,
  evictBelowScore: 1,
  evictAfterDays: 60,
  /** 注入门槛低于淘汰门槛：说过一次的偏好应进 brief，再靠每周衰减自然淡出（约 4 周）。 */
  briefMinScore: 0.5,
  conflictBehaviorHits: 3,
  conflictAskDays: 14,
  briefTags: 10,
  briefTagsPerGroup: 2,
  briefFacts: 6,
} as const;

const DAY_MS = 86_400_000;
const CONFLICT_ANSWER_WINDOW_MS = 2 * 60 * 60 * 1000;

export function emptyUserProfile(): UserProfile {
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    constraints: {},
    constraintsUpdatedAt: null,
    tags: [],
    facts: [],
    conflicts: [],
    violations: [],
    factSeq: 0,
    conflictSeq: 0,
  };
}

/** 读库后的防御性归一化：结构不对或版本不认识时退回空画像，绝不把脏数据注入提示词。 */
export function normalizeUserProfile(value: unknown): UserProfile {
  if (!value || typeof value !== "object") return emptyUserProfile();
  const raw = value as Partial<UserProfile>;
  if (raw.schemaVersion !== PROFILE_SCHEMA_VERSION) return emptyUserProfile();
  const base = emptyUserProfile();
  const constraints: UserProfile["constraints"] = {};
  if (raw.constraints && typeof raw.constraints === "object") {
    for (const key of PROFILE_CONSTRAINT_KEYS) {
      const candidate = (raw.constraints as Record<string, unknown>)[key];
      if (isValidConstraintValue(key, candidate)) constraints[key] = candidate;
    }
  }
  return {
    ...base,
    constraints,
    constraintsUpdatedAt: typeof raw.constraintsUpdatedAt === "string" ? raw.constraintsUpdatedAt : null,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((tag) => tag && TAG_INDEX.has(tag.id) && Number.isFinite(tag.score)) : [],
    facts: Array.isArray(raw.facts) ? raw.facts.filter((fact) => fact && typeof fact.text === "string" && typeof fact.id === "string") : [],
    conflicts: Array.isArray(raw.conflicts) ? raw.conflicts.filter((item) => item && TAG_INDEX.has(item.stated) && TAG_INDEX.has(item.behavior)) : [],
    violations: Array.isArray(raw.violations) ? raw.violations.slice(-PROFILE_LIMITS.violationCap) : [],
    factSeq: Number.isInteger(raw.factSeq) ? raw.factSeq as number : 0,
    conflictSeq: Number.isInteger(raw.conflictSeq) ? raw.conflictSeq as number : 0,
  };
}

function iso(now: Date): string {
  return now.toISOString();
}

function recordViolation(profile: UserProfile, now: Date, reason: string, detail: string): void {
  profile.violations.push({ at: iso(now), reason, detail: detail.slice(0, 40) });
  if (profile.violations.length > PROFILE_LIMITS.violationCap) {
    profile.violations.splice(0, profile.violations.length - PROFILE_LIMITS.violationCap);
  }
}

// ---------------------------------------------------------------- 约束

export function isValidConstraintValue(key: ProfileConstraintKey, value: unknown): value is ProfileConstraintValue {
  const rule: ConstraintRule = PROFILE_CONSTRAINT_RULES[key];
  if (rule.kind === "bool") return typeof value === "boolean";
  if (rule.kind === "int") return typeof value === "number" && Number.isInteger(value) && value >= rule.min && value <= rule.max;
  return typeof value === "string" && rule.values.includes(value);
}

/** 约束只在用户明说时写入；取值不合法直接拒绝。调用方负责保证"用户明说"这一前提。 */
export function setProfileConstraint(profile: UserProfile, key: string, value: unknown, now: Date): boolean {
  if (!PROFILE_CONSTRAINT_KEYS.includes(key as ProfileConstraintKey)) {
    recordViolation(profile, now, "unknown_constraint", key);
    return false;
  }
  const typed = key as ProfileConstraintKey;
  if (!isValidConstraintValue(typed, value)) {
    recordViolation(profile, now, "invalid_constraint_value", `${key}=${String(value)}`);
    return false;
  }
  profile.constraints[typed] = value;
  profile.constraintsUpdatedAt = iso(now);
  return true;
}

export function clearProfileConstraint(profile: UserProfile, key: string, now: Date): boolean {
  if (!PROFILE_CONSTRAINT_KEYS.includes(key as ProfileConstraintKey) || !(key in profile.constraints)) return false;
  delete profile.constraints[key as ProfileConstraintKey];
  profile.constraintsUpdatedAt = iso(now);
  return true;
}

// ---------------------------------------------------------------- 标签

export function effectiveTagScore(tag: ProfileTag, now: Date): number {
  const weeks = Math.max(0, (now.getTime() - Date.parse(tag.at)) / (7 * DAY_MS));
  return tag.score * PROFILE_LIMITS.decayPerWeek ** weeks;
}

function tagGroup(id: string): ProfileGroup | null {
  return TAG_INDEX.get(id)?.group ?? null;
}

function evictTags(profile: UserProfile, now: Date): void {
  // 先淘汰长期无命中且分数过低的，再按有效分执行组内与全局配额（绝不按插入顺序）。
  profile.tags = profile.tags.filter((tag) => !(
    effectiveTagScore(tag, now) < PROFILE_LIMITS.evictBelowScore
    && now.getTime() - Date.parse(tag.at) > PROFILE_LIMITS.evictAfterDays * DAY_MS
  ));
  const ranked = [...profile.tags].sort((a, b) => effectiveTagScore(b, now) - effectiveTagScore(a, now));
  const perGroup = new Map<ProfileGroup, number>();
  const keep = new Set<string>();
  for (const tag of ranked) {
    const group = tagGroup(tag.id);
    if (!group) continue;
    const used = perGroup.get(group) ?? 0;
    if (used >= PROFILE_LIMITS.groupCap || keep.size >= PROFILE_LIMITS.globalCap) continue;
    perGroup.set(group, used + 1);
    keep.add(tag.id);
  }
  profile.tags = profile.tags.filter((tag) => keep.has(tag.id));
}

/** 同一标签重复命中只加计数，不新增条目；词表之外的 id 丢弃并记录。 */
export function hitProfileTag(profile: UserProfile, id: string, evidence: ProfileEvidence, now: Date, weight = 1): ProfileTag | null {
  if (!TAG_INDEX.has(id)) {
    recordViolation(profile, now, "unknown_tag", id);
    return null;
  }
  let tag = profile.tags.find((item) => item.id === id);
  if (!tag) {
    tag = { id, score: 0, hits: 0, statedHits: 0, inferredHits: 0, at: iso(now) };
    profile.tags.push(tag);
  } else {
    tag.score = effectiveTagScore(tag, now); // 先结算衰减，再累加
  }
  tag.score += weight;
  tag.hits += weight;
  if (evidence === "behavior") tag.inferredHits += weight;
  else tag.statedHits += weight;
  tag.at = iso(now);
  evictTags(profile, now);
  return profile.tags.find((item) => item.id === id) ?? null;
}

// ---------------------------------------------------------------- 事实

const NEGATION_MARKS = ["不", "没", "别", "勿", "拒绝"];
const NEGATION_SAFE_WORDS = ["特别", "区别", "别的", "差不多", "不仅", "不但", "不光", "不只", "不过", "不如"];
const CLAUSE_BREAKS = "，。；、！？,.;!? 但而却就才也还又";
const NEGATION_WINDOW = 4;
const MIN_MERGE_LENGTH = 4;
const MERGE_RATIO = 0.5;

function negatedAt(text: string, index: number): boolean {
  let window = text.slice(Math.max(0, index - NEGATION_WINDOW), index);
  let cut = -1;
  for (const mark of CLAUSE_BREAKS) cut = Math.max(cut, window.lastIndexOf(mark));
  window = window.slice(cut + 1);
  for (const word of NEGATION_SAFE_WORDS) window = window.replaceAll(word, "");
  return NEGATION_MARKS.some((mark) => window.includes(mark));
}

/** same：同一件事（只加证据）；opposite：只差一个否定（视为改口）；null：无关。 */
export function profileFactRelation(a: string, b: string): "same" | "opposite" | null {
  if (a === b) return "same";
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const index = long.indexOf(short);
  if (index < 0) return null;
  if (short.length >= 3 && negatedAt(long, index)) return "opposite";
  if (short.length >= MIN_MERGE_LENGTH && short.length / long.length >= MERGE_RATIO) return "same";
  return null;
}

export function liveProfileFacts(profile: UserProfile): ProfileFact[] {
  return profile.facts.filter((fact) => !fact.supersededAt);
}

export function addProfileFact(profile: UserProfile, rawText: string, evidence: ProfileEvidence, now: Date): ProfileFact | null {
  const text = rawText.trim().replace(/\s+/g, " ");
  if (!text) return null;
  if (text.length > PROFILE_LIMITS.factMaxLength) {
    recordViolation(profile, now, "fact_too_long", text);
    return null;
  }
  // 数值属于知识库与求解器，画像里不存副本（版本更新后会全部失真）。
  if (/\d{3,}|\d+(\.\d+)?\s*%/.test(text)) {
    recordViolation(profile, now, "numeric_fact", text);
    return null;
  }
  const counter = evidence === "behavior" ? "inferredHits" : "statedHits";
  const opposite: ProfileFact[] = [];
  for (const fact of liveProfileFacts(profile)) {
    const relation = profileFactRelation(fact.text, text);
    if (relation === "same") {
      fact.hits += 1;
      fact[counter] += 1;
      fact.lastAt = iso(now);
      return fact;
    }
    if (relation === "opposite") opposite.push(fact);
  }
  profile.factSeq += 1;
  const created: ProfileFact = {
    id: `f_${String(profile.factSeq).padStart(3, "0")}`,
    text,
    hits: 1,
    statedHits: evidence === "stated" ? 1 : 0,
    inferredHits: evidence === "behavior" ? 1 : 0,
    at: iso(now),
    lastAt: iso(now),
    supersededAt: null,
    supersededBy: null,
  };
  profile.facts.push(created);
  for (const old of opposite) {
    // 用户改口：旧条目退休并指向新条目，不能给它加证据。
    old.supersededAt = iso(now);
    old.supersededBy = created.id;
  }
  if (profile.facts.length > PROFILE_LIMITS.factCap) {
    // 先丢最早退休的，其次丢证据最少、最久未提的有效事实；刚写入的这条不参与淘汰。
    const retired = profile.facts.filter((fact) => fact.supersededAt).sort((a, b) => a.supersededAt!.localeCompare(b.supersededAt!));
    const live = liveProfileFacts(profile).filter((fact) => fact.id !== created.id)
      .sort((a, b) => a.hits - b.hits || a.lastAt.localeCompare(b.lastAt));
    const drop = retired[0] ?? live[0];
    if (drop) profile.facts = profile.facts.filter((fact) => fact.id !== drop.id);
  }
  return created;
}

/** 退休而非删除：留档以便回答"为什么改了结论"，但不再进入 brief。 */
export function retireProfileFact(profile: UserProfile, textOrId: string, now: Date): number {
  const needle = textOrId.trim();
  if (!needle) return 0;
  let retired = 0;
  for (const fact of liveProfileFacts(profile)) {
    if (fact.id === needle || profileFactRelation(fact.text, needle) === "same") {
      fact.supersededAt = iso(now);
      fact.supersededBy = "user";
      retired += 1;
    }
  }
  return retired;
}

// ---------------------------------------------------------------- 冲突

function openConflict(profile: UserProfile, stated: string, behavior: string): ProfileConflict | undefined {
  return profile.conflicts.find((item) => !item.resolution && item.stated === stated && item.behavior === behavior);
}

export function detectProfileConflicts(profile: UserProfile, now: Date): ProfileConflict[] {
  const byId = new Map(profile.tags.map((tag) => [tag.id, tag]));
  const found: ProfileConflict[] = [];
  for (const [a, b] of PROFILE_EXCLUSIVE_PAIRS) {
    const left = byId.get(a);
    const right = byId.get(b);
    if (!left || !right) continue;
    let stated: ProfileTag;
    let behavior: ProfileTag;
    const threshold = PROFILE_LIMITS.conflictBehaviorHits;
    if (left.statedHits >= 1 && right.inferredHits >= threshold && left.inferredHits <= right.inferredHits) [stated, behavior] = [left, right];
    else if (right.statedHits >= 1 && left.inferredHits >= threshold && right.inferredHits <= left.inferredHits) [stated, behavior] = [right, left];
    else continue;
    if (openConflict(profile, stated.id, behavior.id)) continue;
    const group = tagGroup(stated.id);
    if (!group) continue;
    profile.conflictSeq += 1;
    const conflict: ProfileConflict = {
      id: `c_${String(profile.conflictSeq).padStart(3, "0")}`,
      group,
      stated: stated.id,
      behavior: behavior.id,
      detectedAt: iso(now),
      askedAt: null,
      resolution: null,
    };
    profile.conflicts.push(conflict);
    found.push(conflict);
  }
  return found;
}

export interface ProfileConflictPrompt {
  conflict: ProfileConflict;
  /** ask：本轮应主动问；awaiting：刚问过，只在用户作答时记录，不重复追问。 */
  mode: "ask" | "awaiting";
}

/**
 * 14 天内最多主动问一次。刚问过的冲突在 CONFLICT_ANSWER_WINDOW 内继续出现在 brief 里（mode=awaiting），
 * 否则用户下一轮回答时模型已经看不到冲突 id，无法记录。
 */
export function takeProfileConflictToAsk(profile: UserProfile, now: Date): ProfileConflictPrompt | null {
  let awaiting: ProfileConflict | null = null;
  for (const conflict of profile.conflicts) {
    if (conflict.resolution) continue;
    if (!profile.tags.some((tag) => tag.id === conflict.stated) || !profile.tags.some((tag) => tag.id === conflict.behavior)) continue;
    const asked = conflict.askedAt ? Date.parse(conflict.askedAt) : null;
    if (asked === null || now.getTime() - asked >= PROFILE_LIMITS.conflictAskDays * DAY_MS) {
      conflict.askedAt = iso(now);
      return { conflict, mode: "ask" };
    }
    if (!awaiting && now.getTime() - asked < CONFLICT_ANSWER_WINDOW_MS) awaiting = conflict;
  }
  return awaiting ? { conflict: awaiting, mode: "awaiting" } : null;
}

export function resolveProfileConflict(profile: UserProfile, conflictId: string, choice: ProfileEvidence, now: Date): boolean {
  const conflict = profile.conflicts.find((item) => item.id === conflictId && !item.resolution);
  if (!conflict) return false;
  conflict.resolution = choice;
  conflict.resolvedAt = iso(now);
  const chosen = choice === "stated" ? conflict.stated : conflict.behavior;
  const other = choice === "stated" ? conflict.behavior : conflict.stated;
  hitProfileTag(profile, chosen, "stated", now, 2);
  // 非选中一侧降权而非删除：用户可能改主意，后续行为能把它翻回来。
  const loser = profile.tags.find((tag) => tag.id === other);
  if (loser) {
    loser.score = effectiveTagScore(loser, now) * 0.5;
    loser.at = iso(now);
  }
  return true;
}

// ---------------------------------------------------------------- 注入 brief

function constraintLine(key: ProfileConstraintKey, value: ProfileConstraintValue): string {
  const rule: ConstraintRule = PROFILE_CONSTRAINT_RULES[key];
  if (rule.kind === "bool") return value ? rule.yes : rule.no;
  if (rule.kind === "enum") return `${rule.label}：${value === "pc" ? "电脑" : value === "mobile" ? "手机" : "电脑和手机都用"}`;
  return `${rule.label}：${value}`;
}

export interface ProfileBrief {
  text: string;
  /** 本轮涉及的待澄清冲突；changed=true 时调用方需要保存画像（记录了询问时间）。 */
  conflict: ProfileConflictPrompt | null;
  changed: boolean;
  empty: boolean;
}

/**
 * 生成注入系统提示词的画像摘要。内部字段（score/hits/来源/退休事实/时间戳）一律不出现。
 * 会修改 profile（记录冲突询问时间），调用方需要保存。
 */
export function renderProfileBrief(profile: UserProfile, now: Date): ProfileBrief {
  const lines: string[] = [];
  const known = PROFILE_CONSTRAINT_KEYS.filter((key) => key in profile.constraints);
  const unknown = PROFILE_CONSTRAINT_KEYS.filter((key) => !(key in profile.constraints));
  if (known.length) lines.push(`硬约束（用户明确说过，必须满足）：${known.map((key) => constraintLine(key, profile.constraints[key]!)).join("；")}`);
  if (unknown.length) lines.push(`尚未确认的约束：${unknown.map((key) => PROFILE_CONSTRAINT_RULES[key].label).join("、")}`);

  const ranked = profile.tags
    .map((tag) => ({ tag, score: effectiveTagScore(tag, now) }))
    .filter((item) => item.score >= PROFILE_LIMITS.briefMinScore)
    .sort((a, b) => b.score - a.score);
  const perGroup = new Map<ProfileGroup, number>();
  const picked: string[] = [];
  for (const { tag } of ranked) {
    const group = tagGroup(tag.id);
    if (!group || picked.length >= PROFILE_LIMITS.briefTags) continue;
    const used = perGroup.get(group) ?? 0;
    if (used >= PROFILE_LIMITS.briefTagsPerGroup) continue;
    perGroup.set(group, used + 1);
    picked.push(TAG_INDEX.get(tag.id)!.text);
  }
  if (picked.length) lines.push(`已知偏好（只影响方案排序，可以妥协）：${picked.join("；")}`);

  const facts = liveProfileFacts(profile)
    .sort((a, b) => b.hits - a.hits || b.lastAt.localeCompare(a.lastAt))
    .slice(0, PROFILE_LIMITS.briefFacts);
  if (facts.length) lines.push(`关于这位用户：${facts.map((fact) => fact.text).join("；")}`);

  const conflict = takeProfileConflictToAsk(profile, now);
  if (conflict) {
    const stated = TAG_INDEX.get(conflict.conflict.stated)!.text;
    const behavior = TAG_INDEX.get(conflict.conflict.behavior)!.text;
    lines.push(conflict.mode === "ask"
      ? `待澄清（id=${conflict.conflict.id}）：用户说过「${stated}」，但实际选择多次体现「${behavior}」。在本轮合适的时机用一个具体的二选一问清以后按哪个来；得到回答后调用 update_user_profile 的 resolveConflict 记录。`
      : `待澄清（id=${conflict.conflict.id}，已经问过，不要重复追问）：「${stated}」还是「${behavior}」。如果用户本轮给出了选择，调用 update_user_profile 的 resolveConflict 记录。`);
  }
  const empty = known.length === 0 && picked.length === 0 && facts.length === 0;
  return { text: lines.join("\n"), conflict, changed: conflict?.mode === "ask", empty };
}

// ---------------------------------------------------------------- 批量写入（供工具调用）

export interface ProfileUpdateInput {
  constraints?: Partial<Record<string, unknown>>;
  clearConstraints?: string[];
  preferences?: Array<{ id: string; evidence?: ProfileEvidence }>;
  facts?: Array<{ text: string; evidence?: ProfileEvidence }>;
  retireFacts?: string[];
  resolveConflict?: { id: string; choice: ProfileEvidence };
}

export interface ProfileUpdateResult {
  saved: { constraints: string[]; preferences: string[]; facts: string[]; retiredFacts: number; conflictResolved: boolean };
  rejected: string[];
  newConflicts: Array<{ id: string; stated: string; behavior: string }>;
  changed: boolean;
}

export function applyProfileUpdate(profile: UserProfile, input: ProfileUpdateInput, now: Date): ProfileUpdateResult {
  const result: ProfileUpdateResult = {
    saved: { constraints: [], preferences: [], facts: [], retiredFacts: 0, conflictResolved: false },
    rejected: [],
    newConflicts: [],
    changed: false,
  };
  for (const [key, value] of Object.entries(input.constraints ?? {})) {
    if (value === undefined || value === null) continue;
    if (setProfileConstraint(profile, key, value, now)) result.saved.constraints.push(key);
    else result.rejected.push(`约束 ${key}=${String(value)} 不合法，未写入`);
  }
  for (const key of input.clearConstraints ?? []) {
    if (clearProfileConstraint(profile, key, now)) result.saved.constraints.push(`${key}（已清除）`);
  }
  for (const item of input.preferences ?? []) {
    const tag = hitProfileTag(profile, item.id, item.evidence ?? "stated", now);
    const text = profileTagText(item.id);
    if (text && tag) result.saved.preferences.push(text);
    else if (text) result.saved.preferences.push(text); // 命中后因配额被淘汰：证据已计入，不视为拒绝
    else result.rejected.push(`偏好标签 ${item.id} 不在词表内，未写入`);
  }
  for (const text of input.retireFacts ?? []) result.saved.retiredFacts += retireProfileFact(profile, text, now);
  for (const item of input.facts ?? []) {
    const fact = addProfileFact(profile, item.text, item.evidence ?? "stated", now);
    if (fact) result.saved.facts.push(fact.text);
    else result.rejected.push(`事实「${item.text.slice(0, 20)}」未写入（超过 ${PROFILE_LIMITS.factMaxLength} 字或包含具体数值；数值不进画像）`);
  }
  if (input.resolveConflict) {
    result.saved.conflictResolved = resolveProfileConflict(profile, input.resolveConflict.id, input.resolveConflict.choice, now);
    if (!result.saved.conflictResolved) result.rejected.push(`冲突 ${input.resolveConflict.id} 不存在或已处理`);
  }
  result.newConflicts = detectProfileConflicts(profile, now).map((conflict) => ({
    id: conflict.id,
    stated: TAG_INDEX.get(conflict.stated)!.text,
    behavior: TAG_INDEX.get(conflict.behavior)!.text,
  }));
  result.changed = result.saved.constraints.length > 0 || result.saved.preferences.length > 0 || result.saved.facts.length > 0
    || result.saved.retiredFacts > 0 || result.saved.conflictResolved || result.newConflicts.length > 0 || result.rejected.length > 0;
  return result;
}

/** 给用户看的画像视图（"你记得我什么"）：只含可读文本，不含内部计数。 */
export function describeUserProfile(profile: UserProfile, now: Date) {
  return {
    constraints: PROFILE_CONSTRAINT_KEYS.filter((key) => key in profile.constraints).map((key) => constraintLine(key, profile.constraints[key]!)),
    preferences: profile.tags
      .map((tag) => ({ tag, score: effectiveTagScore(tag, now) }))
      .filter((item) => item.score >= PROFILE_LIMITS.briefMinScore)
      .sort((a, b) => b.score - a.score)
      .map(({ tag }) => TAG_INDEX.get(tag.id)!.text),
    facts: liveProfileFacts(profile).map((fact) => fact.text),
    pendingConflicts: profile.conflicts.filter((item) => !item.resolution).map((item) => ({
      id: item.id,
      stated: TAG_INDEX.get(item.stated)!.text,
      behavior: TAG_INDEX.get(item.behavior)!.text,
    })),
  };
}
