import raw from "./data/ship-data.json" with { type: "json" };
import { loadShipData, skillsAtElite } from "./upstream/ship-data.mjs";
import { normalizeConfig, validateRoster } from "./upstream/config.mjs";
export const SOLVER_REVISION = "455d7f17e06d7bb08ab7cef0f154b72b72455fd4";
export const STORAGE_KEY = "riic:endfield:workspace:v1";
export const CATEGORIES = ["线索", "干员经验", "武器经验", "培养"];
const data = loadShipData(raw);
export const nonSchedulableOperators = raw.operators.filter(op => !op.shipSkills?.length)
  .map(op => ({ id: op.charId, name: op.name }));
export const catalog = raw.operators.filter(op => op.shipSkills?.length).map(op => ({
  id: op.charId, name: op.name, enName: op.enName, rarity: op.rarity,
  profession: op.professionName,
  skills: op.shipSkills.map(s => ({ name: s.name, room: s.roomName, unlock: s.unlock ?? 0, description: s.desc.replace(/<[^>]*>/g, ""), effectKey: s.effect?.key ?? "" })),
}));
export const DEFAULT_OPTIONS = {
  mfg: "1干员1武器", levels: { center: 5, mfg1: 3, mfg2: 3, grow: 3, guest: 3 },
  grow: { 晶植: 9, 菌类: 0, 矿物: 0 }, priority: [...CATEGORIES], assist: false, budget: 200000, time: 5000,
};
const allowedNames = new Set(catalog.map(op => op.name));

export function parseRoster(input) {
  const rawInput = typeof input === "string" ? JSON.parse(input) : input;
  const list = Array.isArray(rawInput) ? rawInput : rawInput?.operators;
  if (Array.isArray(list) && list.length > catalog.length) throw new Error("名单超过当前数据版本的干员数量");
  return validateRoster(list, allowedNames);
}

export function validateOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("设施配置必须是对象");
  if (options.mfg !== undefined && !["1干员1武器", "2干员", "2武器"].includes(options.mfg)) throw new Error("制造舱布局不受支持");
  const cfg = normalizeConfig(options);
  if (cfg.budget.ms > 30000 || cfg.budget.nodes > 2000000) throw new Error("单次搜索上限为 30 秒 / 200 万节点");
  return cfg;
}

export function parseWorkspace(text) {
  const value = JSON.parse(text);
  if (value?.version !== 1 || !Array.isArray(value.operators)) throw new Error("不支持的终末地存档格式");
  const operators = value.operators.length ? parseRoster(value.operators) : [];
  const cfg = validateOptions(value.options);
  const options = {
    mfg: cfg.mfgLabel,
    levels: { center: cfg.levels.center, mfg1: cfg.levels.manufacturing[0], mfg2: cfg.levels.manufacturing[1], grow: cfg.levels.grow, guest: cfg.levels.guest },
    grow: { ...cfg.grow }, priority: [...cfg.priority], assist: cfg.assistOn, budget: cfg.budget.nodes, time: cfg.budget.ms,
  };
  let manual;
  if (value.manual !== undefined) {
    if (!Array.isArray(value.manual) || value.manual.length > 5) throw new Error("手动班表格式错误");
    const roster = new Set(operators.map(op => op.name));
    const seen = new Set();
    manual = manualTemplate(options).map(template => {
      const matches = value.manual.filter(room => room?.key === template.key);
      if (matches.length > 1) throw new Error("手动班表设施重复");
      if (!matches.length) return template;
      const room = matches[0];
      if (!Number.isInteger(room.hour) || room.hour < 1 || room.hour > 23) throw new Error("手动班表换班时刻错误");
      const crew = shift => {
        if (!Array.isArray(room[shift]) || room[shift].length > template.slots) throw new Error("手动班表工位数量错误");
        return room[shift].map(name => {
          if (typeof name !== "string" || (name && (!roster.has(name) || seen.has(name)))) throw new Error("手动班表包含未知或重复干员");
          if (name) seen.add(name);
          return name;
        });
      };
      return { ...template, hour: room.hour, a: crew("a"), b: crew("b") };
    });
  }
  if (value.rosterSource !== undefined && (typeof value.rosterSource !== "string" || !value.rosterSource.length || value.rosterSource.length > 2048)) throw new Error("名单来源格式错误");
  return { version: 1, operators, options, ...(manual ? { manual } : {}), ...(value.rosterSource ? { rosterSource: value.rosterSource } : {}) };
}

export function prepare(input) {
  const operators = parseRoster(input.operators);
  const cfg = validateOptions(input.options);
  const ops = operators.map(op => ({ ...op, charId: data.byName.get(op.name).charId, skills: skillsAtElite(data.byName.get(op.name).skills, op.elite) }));
  return { ops, cfg };
}


export function manualTemplate(options) {
  const cfg = validateOptions(options);
  return [{ key: "中枢", slots: cfg.centerSlots }, ...(cfg.hasGuest ? [{ key: "会客室", slots: cfg.levels.guestSlots }] : []), ...cfg.levels.manufacturingSlots.map((slots, i) => ({ key: `制造舱${i+1}`, slots })), ...(cfg.hasGrow ? [{ key: "培养舱", slots: cfg.levels.growSlots }] : [])].map(room => ({ ...room, hour: 12, a: [], b: [] }));
}
