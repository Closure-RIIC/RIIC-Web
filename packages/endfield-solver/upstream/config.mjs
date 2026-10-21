/**
 * 配置与名单校验（对齐实施方案 §3.1）
 * 所有非法输入在搜索前抛出，错误信息带参数名与原因。
 */

export const MFG_LAYOUTS = {
  '1干员1武器': ['干员经验', '武器经验'],
  '2干员': ['干员经验', '干员经验'],
  '2武器': ['武器经验', '武器经验'],
};
export const CATEGORIES = ['线索', '干员经验', '武器经验', '培养'];
export const GROW_KINDS = ['晶植', '菌类', '矿物'];
export const MAX_ELITE = 4;

export class ConfigError extends Error {
  constructor(param, reason) {
    super(`[${param}] ${reason}`);
    this.name = 'ConfigError';
    this.param = param;
  }
}

const assertFinite = (v, param) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ConfigError(param, `必须是有限数值，收到 ${String(v)}`);
  return v;
};

export function normalizeGrow(raw, maxSlots = 9) {
  const grow = { 晶植: 0, 菌类: 0, 矿物: 0 };
  if (raw == null) return grow;
  if (typeof raw === 'string') {
    const seen = new Set();
    const segments = raw.split(',');
    if (segments.some((segment) => !segment.trim())) throw new ConfigError('--grow', '不能包含空类别项');
    for (const seg of segments) {
      const t = seg.trim();
      const parts = t.split(':').map((s) => s.trim());
      if (parts.length !== 2 || !parts[0] || !parts[1]) throw new ConfigError('--grow', `格式错误「${t}」，应为 类别:槽数`);
      const [k, v] = parts;
      if (!GROW_KINDS.includes(k)) throw new ConfigError('--grow', `不认识的类别「${k}」，只能是 ${GROW_KINDS.join('/')}`);
      if (seen.has(k)) throw new ConfigError('--grow', `类别「${k}」重复出现`);
      seen.add(k);
      const n = Number(v);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) throw new ConfigError('--grow', `「${k}」必须是有限非负整数，收到「${v}」`);
      grow[k] = n;
    }
  } else if (typeof raw === 'object') {
    for (const k of Object.keys(raw)) {
      if (!GROW_KINDS.includes(k)) throw new ConfigError('--grow', `不认识的类别「${k}」`);
      if (!Number.isInteger(raw[k]) || raw[k] < 0) throw new ConfigError('--grow', `「${k}」必须是有限非负整数`);
      grow[k] = raw[k];
    }
  } else {
    throw new ConfigError('--grow', '格式应为 "晶植:9,菌类:0,矿物:0" 或对象');
  }
  const total = GROW_KINDS.reduce((s, k) => s + grow[k], 0);
  if (total > maxSlots) throw new ConfigError('--grow', `槽数之和 ${total} 超过当前培养舱可用的 ${maxSlots} 槽`);
  return grow;
}

export function normalizeLevels(raw) {
  const levels = { center: 5, manufacturing: [3, 3], grow: 3, guest: 3 };
  if (raw != null) {
    const values = {};
    if (typeof raw === 'string') {
      for (const segment of raw.split(',')) {
        const parts = segment.trim().split(':').map((part) => part.trim());
        if (parts.length !== 2 || !parts[0] || !parts[1]) throw new ConfigError('--levels', `格式错误「${segment}」，应为 设施:等级`);
        if (Object.hasOwn(values, parts[0])) throw new ConfigError('--levels', `设施「${parts[0]}」重复出现`);
        values[parts[0]] = Number(parts[1]);
      }
    } else if (typeof raw === 'object' && !Array.isArray(raw)) {
      Object.assign(values, raw);
    } else throw new ConfigError('--levels', '应为对象或 center:5,mfg1:3,mfg2:3,grow:3,guest:3');

    for (const [key, value] of Object.entries(values)) {
      if (!['center', 'mfg1', 'mfg2', 'manufacturing', 'grow', 'guest'].includes(key)) throw new ConfigError('--levels', `不认识的设施「${key}」`);
      if (key === 'manufacturing') {
        if (!Array.isArray(value) || value.length !== 2 || value.some((level) => !Number.isInteger(level))) throw new ConfigError('--levels', 'manufacturing 必须是两个等级组成的数组');
        levels.manufacturing = value.slice();
      } else if (key === 'mfg1') levels.manufacturing[0] = value;
      else if (key === 'mfg2') levels.manufacturing[1] = value;
      else levels[key] = value;
    }
  }

  const availableMfg = levels.center >= 4 ? 3 : levels.center >= 2 ? 2 : 1;
  const availableGrow = levels.center >= 5 ? 3 : levels.center >= 3 ? 2 : levels.center >= 2 ? 1 : 0;
  const availableGuest = levels.center >= 5 ? 3 : levels.center >= 4 ? 2 : levels.center >= 3 ? 1 : 0;
  if (raw != null) {
    const explicit = typeof raw === 'string'
      ? new Set(raw.split(',').map((segment) => segment.trim().split(':')[0].trim()))
      : new Set(Object.keys(raw));
    if (!explicit.has('manufacturing') && !explicit.has('mfg1')) levels.manufacturing[0] = availableMfg;
    if (!explicit.has('manufacturing') && !explicit.has('mfg2')) levels.manufacturing[1] = availableMfg;
    if (!explicit.has('grow')) levels.grow = availableGrow;
    if (!explicit.has('guest')) levels.guest = availableGuest;
  }

  const valid = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
  if (!valid(levels.center, 1, 5)) throw new ConfigError('--levels', 'center 等级必须是 1–5');
  if (levels.manufacturing.some((level) => !valid(level, 1, 3))) throw new ConfigError('--levels', 'mfg1/mfg2 等级必须是 1–3');
  if (!valid(levels.grow, 0, 3)) throw new ConfigError('--levels', 'grow 等级必须是 0–3');
  if (!valid(levels.guest, 0, 3)) throw new ConfigError('--levels', 'guest 等级必须是 0–3');

  const maxManufacturing = levels.center >= 4 ? 3 : levels.center >= 2 ? 2 : 1;
  const maxGrow = levels.center >= 5 ? 3 : levels.center >= 3 ? 2 : levels.center >= 2 ? 1 : 0;
  const maxGuest = levels.center >= 5 ? 3 : levels.center >= 4 ? 2 : levels.center >= 3 ? 1 : 0;
  if (levels.manufacturing.some((level) => level > maxManufacturing)) throw new ConfigError('--levels', `当前中枢等级最多支持制造舱 Lv${maxManufacturing}`);
  if (levels.grow > maxGrow) throw new ConfigError('--levels', `当前中枢等级最多支持培养舱 Lv${maxGrow}`);
  if (levels.guest > maxGuest) throw new ConfigError('--levels', `当前中枢等级最多支持会客室 Lv${maxGuest}`);
  return {
    ...levels,
    centerSlots: Math.min(3, levels.center),
    manufacturingSlots: levels.manufacturing.slice(),
    growSlots: levels.grow,
    growPlots: levels.grow * 3,
    guestSlots: levels.guest,
  };
}

export function normalizePriority(raw) {
  const list = raw == null
    ? CATEGORIES.slice()
    : (Array.isArray(raw) ? raw : String(raw).split(',').map((s) => s.trim()));
  if (list.length !== CATEGORIES.length) throw new ConfigError('--priority', `必须正好是 ${CATEGORIES.join('/')} 的一个排列`);
  const seen = new Set();
  for (const p of list) {
    if (!CATEGORIES.includes(p)) throw new ConfigError('--priority', `不认识「${p}」`);
    if (seen.has(p)) throw new ConfigError('--priority', `重复的类别「${p}」`);
    seen.add(p);
  }
  return list.slice();
}

export function validateRoster(list, tableNames) {
  if (!Array.isArray(list) || list.length === 0) throw new ConfigError('roster', '名单为空');
  const seen = new Set();
  const out = [];
  for (const entry of list) {
    const name = entry && entry.name;
    if (typeof name !== 'string' || !name) throw new ConfigError('roster', '有干员缺少 name');
    if (seen.has(name)) throw new ConfigError('roster', `干员「${name}」重复出现`);
    seen.add(name);
    const elite = entry.elite == null ? MAX_ELITE : entry.elite;
    if (!Number.isInteger(elite) || elite < 0 || elite > MAX_ELITE) {
      throw new ConfigError('roster', `「${name}」的 elite 必须是 0–${MAX_ELITE} 的整数，收到 ${String(entry.elite)}`);
    }
    if (tableNames && !tableNames.has(name)) throw new ConfigError('roster', `技能表里找不到干员「${name}」`);
    out.push({ name, elite });
  }
  return out;
}

export function normalizeConfig(args = {}) {
  const mfg = args.mfg || '1干员1武器';
  const manufacturing = MFG_LAYOUTS[mfg];
  if (!manufacturing) throw new ConfigError('--mfg', `只能是 ${Object.keys(MFG_LAYOUTS).join(' / ')}，收到「${mfg}」`);

  const levels = normalizeLevels(args.levels);
  const growCapacity = levels.growPlots;
  const growInput = args.grow == null ? { 晶植: growCapacity } : args.grow;
  const grow = normalizeGrow(growInput, growCapacity);
  const priority = normalizePriority(args.priority);
  const assistOn = !!args.assist;
  // 预算 200 万节点 / 30 秒，先到先停
  const budget = {
    nodes: args.budget == null ? 2_000_000 : Number(args.budget),
    ms: args.time == null ? 30_000 : Number(args.time),
  };
  assertFinite(budget.nodes, '--budget');
  if (!Number.isSafeInteger(budget.nodes) || budget.nodes <= 0) throw new ConfigError('--budget', '必须为正安全整数');
  assertFinite(budget.ms, '--time');
  if (!Number.isSafeInteger(budget.ms) || budget.ms <= 0) throw new ConfigError('--time', '必须为正安全整数（毫秒）');
  const growTotal = GROW_KINDS.reduce((s, k) => s + grow[k], 0);

  return {
    manufacturing,
    levels,
    centerSlots: levels.centerSlots,
    hasGuest: levels.guest > 0,
    mfgLabel: mfg,
    grow,
    growTotal,
    hasGrow: growTotal > 0,
    priority,
    assistOn,
    assistPoints: assistOn ? 2 : 0,
    budget,
    maxElite: MAX_ELITE,
    limits: {
      // 文档 §D03：统计窗口统一取「第 401–1200 天」
      maxSimDays: 1200,
      burnInDays: 400,
      cycleDetectDays: 64,
      valueTol: 1e-9,
      driftTol: 1e-4,
    },
  };
}
