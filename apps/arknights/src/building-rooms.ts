const OPERATOR_PINYIN_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "仇白": ["qiubai"],
};

// 基建技能房间标签：技能 id 第一个下划线之前就是房间前缀，
// 例如 control_tra_spd_000 → control → 控制中枢。查询索引由调用方提供。

export type BuildingRoomPrefix =
  | "control"
  | "power"
  | "manu"
  | "trade"
  | "dorm"
  | "hire"
  | "meet"
  | "train"
  | "workshop"
  | "recycle";

export const BUILDING_ROOM_LABELS: Readonly<Record<BuildingRoomPrefix, string>> = {
  control: "控制中枢",
  power: "发电站",
  manu: "制造站",
  trade: "贸易站",
  dorm: "宿舍",
  hire: "办公室",
  meet: "会客室",
  train: "训练室",
  workshop: "加工站",
  recycle: "回收站",
};

// 按用户在页面上希望展示的顺序排列，同时驱动标签栏。
export const BUILDING_ROOM_PREFIXES: readonly BuildingRoomPrefix[] = [
  "control",
  "power",
  "manu",
  "trade",
  "dorm",
  "hire",
  "meet",
  "train",
  "workshop",
  "recycle",
];

/**
 * 每个房间下可选的技能标签（技能查询二级筛选），直接写死以稳定展示顺序。
 * 注意：数据仓库新增带标签技能时需要同步本表，否则该标签在 UI 中不可选。
 */
export const ROOM_SKILL_TAGS: Readonly<Record<BuildingRoomPrefix, readonly string[]>> = {
  control: ["生产力", "订单效率", "办公室", "线索倾向", "线索搜集", "心情消耗"],
  power: [],
  manu: ["贵金属", "作战记录", "源石", "通用生产", "仓库容量"],
  trade: ["订单效率", "订单上限", "特殊订单", "高品质"],
  dorm: ["单体恢复", "群体恢复", "特殊恢复", "自身恢复"],
  hire: ["联络速度", "特殊加成"],
  meet: ["未拥有加成", "无特别加成", "线索1", "线索2", "线索3", "线索4", "线索5", "线索6", "线索7"],
  train: ["全能", "减半", "辅助", "近卫", "狙击", "术师", "特种", "先锋", "医疗", "重装"],
  workshop: ["精英材料", "技巧概要", "基建材料", "芯片", "任意材料"],
  recycle: ["转化效率"],
};

const BUILDING_ROOM_PREFIX_SET = new Set<string>(BUILDING_ROOM_PREFIXES);

export function buildingRoomPrefixForSkillId(skillId: string): BuildingRoomPrefix | null {
  const prefix = skillId.split("_", 1)[0] ?? "";
  return BUILDING_ROOM_PREFIX_SET.has(prefix) ? (prefix as BuildingRoomPrefix) : null;
}

export interface OperatorWithSkills {
  name: string;
  rarity?: number;
  profession?: number;
  buildingSkills: readonly { id: string }[];
  /** 数据仓库 building.json char 字段中的原始顺序（生成时写入），用于默认倒序展示。 */
  order?: number;
}

/** 按技能 id 查询技能记录的最小结构（标签/名称/纯文本描述），避免本模块直接依赖生成的 JSON。 */
export interface SkillRecord {
  name?: string;
  description?: string;
  tags?: readonly string[];
}

export type SkillRecordLookup = (skillId: string) => SkillRecord | undefined;

export interface OperatorFilters {
  rarity?: number | null;
  profession?: number | null;
  englishNames?: Readonly<Record<string, string>>;
  pinyinNames?: Readonly<Record<string, readonly string[]>>;
}

export function operatorMatchesRoom(
  skillIds: readonly string[],
  room: BuildingRoomPrefix | null,
): boolean {
  if (room === null) return true;
  return skillIds.some((id) => buildingRoomPrefixForSkillId(id) === room);
}

export function operatorMatchesTag(
  skillIds: readonly string[],
  room: BuildingRoomPrefix | null,
  tag: string | null,
  skillLookup: SkillRecordLookup,
): boolean {
  if (!tag) return true;
  return skillIds.some((id) => {
    if (room !== null && buildingRoomPrefixForSkillId(id) !== room) return false;
    return (skillLookup(id)?.tags ?? []).includes(tag);
  });
}

export function operatorMatchesNameContains(name: string, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  if (!normalizedQuery) return true;
  return name.toLocaleLowerCase("zh-CN").includes(normalizedQuery);
}

function operatorNameMatchesQuery(name: string, query: string, pinyinNames?: OperatorFilters["pinyinNames"]): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  if (!normalizedQuery) return true;
  if (name.toLocaleLowerCase("zh-CN").includes(normalizedQuery)) return true;
  return (pinyinNames?.[name] ?? []).some((value) => value.includes(normalizedQuery))
    || Boolean(pinyinNames && (OPERATOR_PINYIN_ALIASES[name] ?? []).some((alias) => alias.includes(normalizedQuery)));
}

/** 搜索命中干员名称、技能名称或技能纯文本描述（任意一项命中即可）。 */
export function operatorMatchesQuery(
  name: string,
  skillIds: readonly string[],
  query: string,
  skillLookup: SkillRecordLookup,
  englishNames?: Readonly<Record<string, string>>,
  pinyinNames?: OperatorFilters["pinyinNames"],
): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  if (!normalizedQuery) return true;
  if (operatorNameMatchesQuery(name, normalizedQuery, pinyinNames)) return true;
  const englishName = englishNames?.[name];
  if (englishName?.toLocaleLowerCase("en-US").includes(normalizedQuery.toLocaleLowerCase("en-US"))) return true;
  return skillIds.some((id) => {
    const skill = skillLookup(id);
    if (!skill) return false;
    return (
      (skill.name ?? "").toLocaleLowerCase("zh-CN").includes(normalizedQuery)
      || (skill.description ?? "").toLocaleLowerCase("zh-CN").includes(normalizedQuery)
    );
  });
}

export function filterOperators<T extends OperatorWithSkills>(
  operators: readonly T[],
  room: BuildingRoomPrefix | null,
  tag: string | null,
  query: string,
  skillLookup: SkillRecordLookup,
  filters: OperatorFilters = {},
): T[] {
  const normalizedQuery = query.trim();
  return operators
    .filter((operator) => {
      const skillIds = operator.buildingSkills.map((skill) => skill.id);
      return (
        (filters.rarity == null || operator.rarity === filters.rarity)
        && (filters.profession == null || operator.profession === filters.profession)
        &&
        operatorMatchesRoom(skillIds, room)
        && operatorMatchesTag(skillIds, room, tag, skillLookup)
        && operatorMatchesQuery(operator.name, skillIds, query, skillLookup, filters.englishNames, filters.pinyinNames)
      );
    })
    .sort((left, right) => {
      // 搜索时按名字排序便于查找；默认浏览按数据仓库原始顺序倒序（新在前）。
      if (normalizedQuery) return left.name.localeCompare(right.name, "zh-CN");
      return (right.order ?? 0) - (left.order ?? 0) || left.name.localeCompare(right.name, "zh-CN");
    });
}
