import { catalog } from "@shared/endfield-solver/model.mjs";
import { FilterRow } from "@shared/ui-primitives/filter-row";
import { Tabs, TabsList, TabsTrigger } from "@shared/ui-primitives/tabs";
import { useWorkspace } from "../state";

const professions: Record<string, string> = { 先锋: "Vanguard", 近卫: "Guard", 突击: "Striker", 重装: "Defender", 术师: "Caster", 辅助: "Support" };
const effects: Record<string, [string, string]> = {
  MoodRecoveryAll: ["心情恢复", "Morale recovery"],
  RoomMoodConsumeDown: ["心情消耗", "Morale consumption"],
  ManufactureEfficiencyUp: ["生产效率", "Production efficiency"],
  GrowSpeedUp: ["培养速度", "Growth speed"],
  ClueProbabilityUp: ["线索倾向", "Clue probability"],
  ClueEfficiencyUp: ["线索收集", "Clue collection"],
};
const rooms = Array.from(new Set(catalog.flatMap(op => op.skills.map(skill => skill.room))));

function FilterOptions({ label, value, onChange, options }: {
  label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[];
}) {
  const { t } = useWorkspace();
  return <Tabs value={value} onValueChange={onChange}>
    <TabsList aria-label={label}>
      <TabsTrigger value="all">{t("全部", "All")}</TabsTrigger>
      {options.map(option => <TabsTrigger key={option.value} value={option.value}>{option.label}</TabsTrigger>)}
    </TabsList>
  </Tabs>;
}

export function SkillFilters({ rarity, profession, room, tag, onRarityChange, onProfessionChange, onRoomChange, onTagChange, facilityLabel }: {
  rarity: string; profession: string; room: string; tag: string;
  onRarityChange: (value: string) => void; onProfessionChange: (value: string) => void;
  onRoomChange: (value: string) => void; onTagChange: (value: string) => void;
  facilityLabel: (value: string) => string;
}) {
  const { t } = useWorkspace();
  const tags = room === "all" ? [] : Array.from(new Set(catalog.flatMap(op => op.skills.filter(skill => skill.room === room).map(skill => skill.effectKey)))).filter(Boolean);
  return <div className="mt-3 grid min-w-0 gap-1" data-skill-filters>
    <FilterRow label={t("星级", "Rarity")}>
      <FilterOptions label={t("稀有度筛选", "Filter rarity")} value={rarity} onChange={onRarityChange} options={[6, 5, 4].map(n => ({ value: String(n), label: `${n}★` }))} />
    </FilterRow>
    <FilterRow label={t("职业", "Profession")}>
      <FilterOptions label={t("职业筛选", "Filter profession")} value={profession} onChange={onProfessionChange} options={Object.entries(professions).map(([value, en]) => ({ value, label: t(value, en) }))} />
    </FilterRow>
    <FilterRow label={t("工作房间", "Work room")}>
      <FilterOptions label={t("设施筛选", "Filter facility")} value={room} onChange={onRoomChange} options={rooms.map(value => ({ value, label: facilityLabel(value) }))} />
    </FilterRow>
    <FilterRow label={t("技能标签", "Skill tags")}>
      {tags.length ? <FilterOptions label={t("技能标签筛选", "Filter skill tags")} value={tag} onChange={onTagChange} options={tags.map(value => ({ value, label: effects[value] ? t(...effects[value]) : value }))} />
        : <p className="flex min-h-7 items-center text-xs text-muted-foreground max-sm:min-h-11">{room === "all" ? t("请先选择工作房间", "Choose a work room first") : t("该房间暂无技能标签", "No skill tags for this room")}</p>}
    </FilterRow>
  </div>;
}
