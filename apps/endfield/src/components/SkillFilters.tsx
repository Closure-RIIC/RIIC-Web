import { gameLabel } from "../i18n/game-labels";
import type { ReactNode } from "react";
import { allSkills, operatorCatalog, type DisplaySkill } from "@riic/endfield-data";
import { FilterRow } from "@riic/ui-primitives/filter-row";
import { Tabs, TabsList, TabsTrigger } from "@riic/ui-primitives/tabs";
import { useWorkspace } from "../state";

/** 职业与房间名都直接来自 catalog.json，不再依赖求解器的数据。 */
const professions = Array.from(new Set(operatorCatalog.map(op => op.profession).filter(Boolean)));
/**
 * 筛选标签是界面文案，用短名；catalog 里的 `effectName` 是数据层的完整枚举名
 * （「制造舱 · 指定经验素材生产效率提升」），不适合直接当标签。
 *
 * 带目标的技能细化到产物：制造舱按干员/武器经验、培养舱按菌类/晶植/矿物分别成标签，
 * 否则同一条「生产效率」会把两种完全不同的干员混在一起。
 */
const effects: Record<string, string> = {
  MoodRecoveryAll: "心情恢复",
  RoomMoodConsumeDown: "心情消耗",
  ClueProbabilityUp: "线索倾向",
  ClueEfficiencyUp: "线索收集",
};

/** 标签值 = effectKey（无目标时）或 `${effectKey}:${target}`（带目标时）。 */
export function skillTagOf(skill: { effectKey?: string | null; target?: string | null }): string | null {
  if (!skill.effectKey) return null;
  return skill.target ? `${skill.effectKey}:${skill.target}` : skill.effectKey;
}

/**
 * 标签顺序按房间显式写死，不靠数据遍历顺序：
 * 会客室把「线索 1..7」按数字排，制造舱/培养舱先产出再心情消耗。未列出的排到最后。
 */
const TAG_ORDER: Record<string, string[]> = {
  "总控中枢": ["MoodRecoveryAll"],
  "会客室(线索)": [
    "RoomMoodConsumeDown",
    "ClueEfficiencyUp",
    ...Array.from({ length: 7 }, (_, index) => `ClueProbabilityUp:线索 ${index + 1}`),
  ],
  "制造舱": [
    "ManufactureEfficiencyUp:干员经验",
    "ManufactureEfficiencyUp:武器经验",
    "RoomMoodConsumeDown",
  ],
  "培养舱": ["GrowSpeedUp:菌类", "GrowSpeedUp:晶植", "GrowSpeedUp:矿物", "RoomMoodConsumeDown"],
};

/** 各房间实际出现的标签；顺序由 TAG_ORDER 决定，未登记的排在末尾（保持稳定）。 */
const tagsByRoom = new Map<string, Map<string, string>>();
for (const skill of allSkills() as readonly DisplaySkill[]) {
  const tag = skillTagOf(skill);
  if (!tag) continue;
  const list = tagsByRoom.get(skill.room) ?? new Map<string, string>();
  if (!list.has(tag)) list.set(tag, skill.target || effects[skill.effectKey] || skill.effectKey);
  tagsByRoom.set(skill.room, list);
}
const rooms = Array.from(new Set(operatorCatalog.flatMap(op => op.skills.map(skill => skill.room).filter(Boolean))));

function tagsOf(room: string): { value: string; label: string }[] {
  const order = TAG_ORDER[room] ?? [];
  const rank = (value: string) => {
    const index = order.indexOf(value);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  return [...(tagsByRoom.get(room) ?? new Map())]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => rank(a.value) - rank(b.value) || a.value.localeCompare(b.value));
}

function FilterOptions({ label, value, onChange, options }: {
  label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[];
}) {
  const { t } = useWorkspace();
  return <Tabs value={value} onValueChange={onChange}>
    <TabsList aria-label={label}>
      <TabsTrigger value="all">{t("SkillFilters.all")}</TabsTrigger>
      {options.map(option => <TabsTrigger key={option.value} value={option.value}>{option.label}</TabsTrigger>)}
    </TabsList>
  </Tabs>;
}

export function SkillFilters({ rarity, profession, room, tag, onRarityChange, onProfessionChange, onRoomChange, onTagChange, facilityLabel, rarityActions }: {
  rarity: string; profession: string; room: string; tag: string;
  onRarityChange: (value: string) => void; onProfessionChange: (value: string) => void;
  onRoomChange: (value: string) => void; onTagChange: (value: string) => void;
  facilityLabel: (value: string) => string;
  rarityActions?: ReactNode;
}) {
  const { t } = useWorkspace();
  const tags = room === "all" ? [] : tagsOf(room);
  return <div className="mt-3 grid min-w-0 gap-1" data-skill-filters>
    <div className={rarityActions ? "ef-skill-rarity-row" : undefined}>
      <FilterRow label={t("SkillFilters.rarity")}>
        <FilterOptions label={t("SkillFilters.filterRarity")} value={rarity} onChange={onRarityChange} options={[6, 5, 4].map(n => ({ value: String(n), label: `${n}★` }))} />
      </FilterRow>
      {rarityActions ? <div className="ef-roster-top-actions">{rarityActions}</div> : null}
    </div>
    <FilterRow label={t("SkillFilters.profession")}>
      <FilterOptions label={t("SkillFilters.filterProfession")} value={profession} onChange={onProfessionChange} options={professions.map(value => ({ value, label: gameLabel(t, value) }))} />
    </FilterRow>
    <FilterRow label={t("SkillFilters.workRoom")}>
      <FilterOptions label={t("SkillFilters.filterFacility")} value={room} onChange={onRoomChange} options={rooms.map(value => ({ value, label: facilityLabel(value) }))} />
    </FilterRow>
    <FilterRow label={t("SkillFilters.skillTags")}>
      {tags.length ? <FilterOptions label={t("SkillFilters.filterSkillTags")} value={tag} onChange={onTagChange} options={tags.map(({ value, label }) => ({ value, label: gameLabel(t, label) }))} />
        : <p className="flex min-h-7 items-center text-xs text-muted-foreground max-sm:min-h-11">{room === "all" ? t("SkillFilters.chooseAWorkRoomFirst") : t("SkillFilters.noSkillTagsForThisRoom")}</p>}
    </FilterRow>
  </div>;
}
