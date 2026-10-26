import { Fragment, useState } from "react";
import { Download, Check, Plus, X } from "lucide-react";
import type { Operator } from "@riic/endfield-solver/model.mjs";
import { Action, Notice, PageTitle, Section } from "@riic/endfield-ui";
import { downloadJson, useWorkspace } from "../state";
import { pageLabels } from "../page-labels";
import { compareOperatorRelease, operatorCatalog, skillTiersOf, type DisplayOperator, type DisplaySkillTier } from "@riic/endfield-data";
import { SearchInput } from "@riic/ui-primitives/search-input";
import { parseSkillNodeId, reconcileSkillNodes, requiredElite, toggleSkillNode, unlockedSkillNodes } from "@riic/endfield-skland/skill-nodes";
import { FilterSelect } from "@riic/ui-primitives/filter-select";
import { SelectionButton } from "@riic/ui-primitives/selection-button";
import { Button } from "@riic/ui-primitives/button";
import { GameArtwork, OperatorPortrait } from "./GameArtwork";
import { SkillFilters, skillTagOf } from "./SkillFilters";
import { ManualOperatorChoice } from "./ManualOperatorChoice";
import { OperatorSkillTooltip } from "./OperatorSkillTooltip";

const skillCatalog = [...operatorCatalog].sort(compareOperatorRelease);
const byName = new Map(operatorCatalog.map(op => [op.name, op]));

type OperatorPicker = { value: string; unavailable: ReadonlySet<string>; onSelect: (name: string) => void };

/** 列表/搜索用的技能文本：中英文名称与描述都在 catalog 里。 */
function searchable(op: DisplayOperator): string {
  return `${op.name} ${op.enName} ${op.profession} ${op.enProfession} ${op.skills.map(s => `${s.name} ${s.enName} ${s.description} ${s.enDescription} ${s.room}`).join(" ")}`.toLowerCase();
}

/** The two skill rows retain their offset, with tiers ordered from left to right. */
function ShipSkillNodes({ tiers, latestSpaceshipSkillNodes, elite, disabled, onToggle }: {
  tiers: DisplaySkillTier[];
  latestSpaceshipSkillNodes?: string[];
  elite: number;
  disabled: boolean;
  onToggle: (nodeId: string) => void;
}) {
  const { locale, t } = useWorkspace();
  const unlocked = new Set(unlockedSkillNodes(tiers, { elite, latestSpaceshipSkillNodes }));
  const bySlot = new Map<number, DisplaySkillTier[]>();
  for (const skill of tiers) {
    const list = bySlot.get(skill.slot) ?? [];
    list.push(skill);
    bySlot.set(skill.slot, list);
  }
  const slots = [...bySlot.entries()]
    .sort(([a], [b]) => a - b)
    .map(([slot, list]) => [slot, list.slice().sort((a, b) => a.level - b.level)] as const);
  if (!slots.length) return null;
  return (
    <div className="ef-skill-nodes" role="group" aria-label={t("基建技能解锁", "Ship skill unlocks")}>
      {slots.map(([slot, list], row) => (
        <div className="ef-skill-node-row" key={slot} data-row={row}>
          {list.map((skill, index) => {
            const active = unlocked.has(skill.nodeId);
            const name = locale === "en" ? skill.enName || skill.name : skill.name;
            return (
              <Fragment key={skill.nodeId}>
                {index > 0 ? <span className="ef-skill-node-link" data-active={active || undefined} aria-hidden /> : null}
                <button type="button" className="ef-skill-node" data-active={active || undefined} disabled={disabled}
                  aria-pressed={active} aria-label={`${name} · E${skill.unlock}`}
                  title={active ? name : `${name} · ${t("需要精英化", "Requires elite")} ${skill.unlock}`}
                  onClick={() => onToggle(skill.nodeId)}>
                  <GameArtwork src={skill.icon} name={name} size={30} />
                  <small>E{skill.unlock}</small>
                </button>
              </Fragment>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function RosterPage({ skillsOnly = false, embedded = false, picker }: { skillsOnly?: boolean; embedded?: boolean; picker?: OperatorPicker }) {
  const { workspace, update, t, locale, ready, storageError } = useWorkspace();
  const [query, setQuery] = useState("");
  const [onlyOwned, setOnlyOwned] = useState(false);
  const [upgradeChoicesOpen, setUpgradeChoicesOpen] = useState(false);
  const [rarity, setRarity] = useState("all");
  const [room, setRoom] = useState("all");
  const [profession, setProfession] = useState("all");
  const [tag, setTag] = useState("all");
  const selected = new Map((skillsOnly ? [] : workspace.operators).map(op => [op.name, op.elite]));
  const needle = query.trim().toLowerCase();
  const rows = (skillsOnly ? skillCatalog : operatorCatalog).filter(op => (skillsOnly || !(onlyOwned || picker) || selected.has(op.name))
    && (rarity === "all" || op.rarity === Number(rarity))
    && (profession === "all" || op.profession === profession)
    && op.skills.some(skill => (room === "all" || skill.room === room) && (tag === "all" || skillTagOf(skill) === tag))
    && (!needle || searchable(op).includes(needle)));
  const emptyText = t("没有匹配选项", "No matching options");
  const facilityLabel = (value: string) => {
    if (locale !== "en") return value;
    const skill = operatorCatalog.flatMap(op => op.skills).find(item => item.room === value);
    return skill?.enRoom || value;
  };
  function save(operators: Operator[]) {
    const owned = new Set(operators.map(op => op.name));
    const manual = workspace.manual?.map(room => ({ ...room, a: room.a.map(n => owned.has(n) ? n : ""), b: room.b.map(n => owned.has(n) ? n : "") }));
    update({ ...workspace, operators, ...(manual ? { manual } : {}) });
  }

  /**
   * 「获取所有干员并且全精4」只收录有基建技能的干员。
   * 用 skills.length 而不是名字判断：管理员的两个分支同名且都没有基建技能，
   * 加进名单会超出求解器认可的人数（32 名可排班干员）。
   */
  function maxRoster(includeAll: boolean) {
    const schedulable = operatorCatalog.filter(op => op.skills.length > 0);
    const entries = includeAll ? schedulable.map(op => workspace.operators.find(entry => entry.name === op.name) ?? { name: op.name, elite: 0 }) : workspace.operators;
    save(entries.map(entry => {
      const op = byName.get(entry.name);
      if (!op) return entry;
      const tiers = skillTiersOf(op.name);
      const nodes = tiers.map(skill => skill.nodeId).sort((a, b) => (parseSkillNodeId(b)?.level ?? 0) - (parseSkillNodeId(a)?.level ?? 0));
      return { ...entry, elite: 4, latestSpaceshipSkillNodes: reconcileSkillNodes(tiers, nodes, 4) };
    }));
    setUpgradeChoicesOpen(false);
  }

  /** 当前生效的节点：没有字段时按精英化回退，并收敛成每槽最高档。 */
  function currentNodes(op: DisplayOperator, entry: Operator) {
    const tiers = skillTiersOf(op.name);
    const nodes = entry.latestSpaceshipSkillNodes
      ?? unlockedSkillNodes(tiers, entry).filter((id) => {
        const parsed = parseSkillNodeId(id);
        const top = tiers.filter(skill => skill.slot === parsed?.slot).reduce((max, skill) => Math.max(max, skill.level), 0);
        return (parsed?.level ?? 0) === top;
      });
    return reconcileSkillNodes(tiers, nodes, entry.elite);
  }

  /**
   * 点击技能节点：按状态里存的档位切换。
   * - 点已存的档 → 降一档；已是最低档 → 删掉该槽（技能变为未解锁）；
   * - 点同槽另一档 → 直接换成它；
   * - 该槽原本没有节点 → 加入这一档。
   * 换到更高档而精英化不够时自动提级；精英化永不因点击而降低。
   */
  function toggleNode(op: DisplayOperator, nodeId: string) {
    const entry = workspace.operators.find(item => item.name === op.name);
    if (!entry) return;
    const tiers = skillTiersOf(op.name);
    if (!tiers.some(skill => skill.nodeId === nodeId)) return;
    const next = toggleSkillNode(tiers, currentNodes(op, entry), nodeId);
    const elite = requiredElite(tiers, next, entry.elite);
    save(workspace.operators.map(item => item.name === op.name ? { ...item, elite, latestSpaceshipSkillNodes: next } : item));
  }

  /** 修改精英化：调低时把无法解锁的档降到可解锁的最高档；调高不补技能。 */
  function changeElite(op: DisplayOperator, entry: Operator, nextElite: number) {
    const tiers = skillTiersOf(op.name);
    const next = reconcileSkillNodes(tiers, currentNodes(op, entry), nextElite);
    save(workspace.operators.map(item => item.name === op.name
      ? { ...item, elite: nextElite, latestSpaceshipSkillNodes: next.length ? next : [] }
      : item));
  }

  return <div className={embedded ? "ef-roster-editor" : "ef-page"}>
    {!embedded ? <PageTitle title={skillsOnly ? t(...pageLabels["/skills"]) : t("我的干员", "My operators")} subtitle={skillsOnly ? undefined : t("只勾选你已拥有的干员，并设置实际精英化阶段。", "Select the operators you own and set their actual elite stages.")}
      meta={skillsOnly ? <span className="ef-muted" aria-live="polite">{t(`${rows.length} 名干员`, `${rows.length} operators`)}</span> : undefined}
      action={!skillsOnly ? <Action variant="dark" icon={<Download />} disabled={!ready} onClick={() => downloadJson("endfield-roster.json", { operators: workspace.operators })}>{t("导出名单", "Export roster")}</Action>
        : <Button type="button" variant="ghost" size="sm" disabled={rarity === "all" && profession === "all" && room === "all" && tag === "all"}
          onClick={() => { setRarity("all"); setProfession("all"); setRoom("all"); setTag("all"); }}><X aria-hidden />{t("清除选择", "Clear filters")}</Button>} /> : null}
    {!skillsOnly && storageError ? <Notice error>{storageError}</Notice> : null}
    <>
      <SkillFilters rarity={rarity} profession={profession} room={room} tag={tag} onRarityChange={setRarity} onProfessionChange={setProfession}
        onRoomChange={value => { setRoom(value); setTag("all"); }} onTagChange={setTag} facilityLabel={facilityLabel} />
      <SearchInput containerClassName="mt-3" label={t("搜索干员或技能", "Search operators or skills")} placeholder={t("搜索干员、技能名称或效果…", "Search operators, skill names or effects…")} value={query} onChange={e => setQuery(e.target.value)} onClear={() => setQuery("")} clearLabel={t("清空搜索", "Clear search")} />
    </>
    <Section>
      {!skillsOnly ? <div className="ef-roster-toolbar">
        <div className="ef-roster-filters">
          {!picker ? <SelectionButton selected={onlyOwned} onSelectedChange={setOnlyOwned}>{t("仅已选", "Selected only")}</SelectionButton> : null}
          {!picker ? <div className="flex flex-wrap items-center gap-2" onKeyDown={event => { if (event.key === "Escape") setUpgradeChoicesOpen(false); }}>
            <Button type="button" variant="outline" disabled={!ready} aria-expanded={upgradeChoicesOpen}
              onClick={() => setUpgradeChoicesOpen(value => !value)}>{t("全精4 · 技能全解锁", "Elite 4 · Unlock all skills")}</Button>
            {upgradeChoicesOpen ? <div className="flex flex-wrap gap-2" role="group" aria-label={t("选择升级范围", "Choose upgrade scope")}>
              <Button type="button" variant="outline" className="h-auto min-h-11 flex-col items-start gap-1 whitespace-normal px-3 py-2 shadow-sm" disabled={!ready || selected.size === 0} onClick={() => maxRoster(false)}>
                <span>{t("仅改变已拥有的状态", "Upgrade owned operators only")}</span>
                <small className="font-normal text-muted-foreground">{t("保留名单 · 全精4与技能全解锁", "Keep roster · Elite 4 and all skills")}</small>
              </Button>
              <Button type="button" variant="outline" className="h-auto min-h-11 flex-col items-start gap-1 whitespace-normal px-3 py-2 shadow-sm" disabled={!ready} onClick={() => maxRoster(true)}>
                <span>{t("获取所有干员并且全精4", "Add all operators at elite 4")}</span>
                <small className="font-normal text-muted-foreground">{t("加入全部干员 · 技能全解锁", "Full roster · All skills unlocked")}</small>
              </Button>
            </div> : null}
          </div> : null}
          <Button type="button" variant="ghost" size="sm" disabled={rarity === "all" && profession === "all" && room === "all" && tag === "all"}
            onClick={() => { setRarity("all"); setProfession("all"); setRoom("all"); setTag("all"); }}><X aria-hidden />{t("清除选择", "Clear filters")}</Button>
          <span className="ef-roster-count ef-muted" role="status">{picker
            ? t(`显示 ${rows.length} 名 · 仅已拥有干员`, `${rows.length} shown · Owned operators only`)
            : t(`显示 ${rows.length} 名 · 已选 ${selected.size}`, `${rows.length} shown · ${selected.size} selected`)}</span>
        </div>
      </div> : null}
      <div className={picker ? "ef-manual-picker-grid" : `ef-roster-grid ${skillsOnly ? "ef-roster-grid--skills" : "ef-roster-grid--compact"}`}>{rows.map(op => {
        if (picker) {
          const current = picker.value === op.name;
          const unavailable = picker.unavailable.has(op.name);
          return <ManualOperatorChoice key={op.id} operator={op} owned={workspace.operators.find(item => item.name === op.name)!}
            selected={current} unavailable={unavailable} onSelect={() => picker.onSelect(op.name)} />;
        }
        const ownedOperator = skillsOnly ? undefined : workspace.operators.find(item => item.name === op.name);
        const matchingSkills = op.skills.filter(skill => (room === "all" || skill.room === room) && (tag === "all" || skillTagOf(skill) === tag));
        const facilities = Array.from(new Set(matchingSkills.map(skill => skill.room)));
        const skillList = skillsOnly ? <div className="ef-ship-skills">{facilities.map(facility => <div className="ef-skill-group" key={facility}>
          <p className="ef-skill-facility">{facilityLabel(facility)}</p>
          <div className="ef-skill-variants">{matchingSkills.filter(skill => skill.room === facility).map((skill, i) =>
            <div key={i} className="ef-ship-skill">
              <GameArtwork src={skill.icon} name={skill.name} size={36} className="ef-skill-artwork" />
              <div><h4>{locale === "en" ? skill.enName || skill.name : skill.name}<small title={t(`精英化 ${skill.unlock} 解锁`, `Unlocked at elite ${skill.unlock}`)}>E{skill.unlock}</small></h4>
                <p>{locale === "en" ? skill.enDescription || skill.description : skill.description}</p></div>
            </div>)}</div></div>)}</div> : null;
        return <article key={op.id} className="ef-roster-card" data-operator-id={op.id} data-selected={skillsOnly ? undefined : selected.has(op.name)}>
          <header>{(skillsOnly ? <OperatorPortrait name={op.id} size={96} elite={null} />
            : <OperatorSkillTooltip name={op.name}><OperatorPortrait name={op.id} size={48} showTitle={false} /></OperatorSkillTooltip>)}<div className="ef-roster-identity"><h3>{locale === "en" ? op.enName : op.name}</h3><p><span className="ef-roster-rarity">{op.rarity}★</span>{skillsOnly ? <span>{locale === "en" ? op.name : op.enName}</span> : null}</p></div>
            {!skillsOnly ? <SelectionButton selected={selected.has(op.name)} aria-label={t(`拥有${op.name}`, `Own ${op.enName}`)} disabled={!ready} size="icon" className="ef-roster-own rounded-full"
              title={selected.has(op.name) ? t("移出我的干员", "Remove from my operators") : t("加入我的干员", "Add to my operators")}
              onSelectedChange={owned => save(owned ? [...workspace.operators, { name: op.name, elite: 0 }] : workspace.operators.filter(x => x.name !== op.name))}>
              {selected.has(op.name) ? <Check aria-hidden /> : <Plus aria-hidden />}
            </SelectionButton> : null}
          </header>
          {!skillsOnly ? <div className="ef-roster-controls"><div className="ef-roster-elite"><label htmlFor={`elite-${op.id}`}>{t("精英化", "Elite stage")}</label><div className="ef-roster-elite-select"><FilterSelect id={`elite-${op.id}`} aria-label={`${op.name} ${t("精英化", "elite stage")}`} value={selected.get(op.name) ?? 0} disabled={!ready || !selected.has(op.name)} onValueChange={value => { const entry = workspace.operators.find(item => item.name === op.name); if (entry) changeElite(op, entry, Number(value)); }} emptyText={emptyText} options={[0,1,2,3,4].map(value => ({ value, label: `E${value}` }))} /></div></div>
            <ShipSkillNodes tiers={skillTiersOf(op.name)} latestSpaceshipSkillNodes={ownedOperator?.latestSpaceshipSkillNodes} elite={ownedOperator?.elite ?? 0} disabled={!ready || !ownedOperator} onToggle={nodeId => toggleNode(op, nodeId)} />
          </div> : null}
          {skillList}
        </article>;
      })}</div>{rows.length === 0 ? <Notice>{t("没有匹配的干员。", "No matching operators.")}</Notice> : null}
    </Section>
  </div>;
}
