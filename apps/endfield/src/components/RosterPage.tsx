import { Fragment, useState } from "react";
import { Download, Check, Plus, X } from "lucide-react";
import { catalog, type Operator } from "@shared/endfield-solver/model.mjs";
import { Action, Notice, PageTitle, Section } from "@shared/endfield-ui";
import { downloadJson, useWorkspace } from "../state";
import { compareOperatorRelease, operatorData } from "@shared/endfield-data";
import { parseSkillNodeId, reconcileSkillNodes, requiredElite, toggleSkillNode, unlockedSkillNodes } from "@shared/endfield-skland/skill-nodes.ts";
import { FilterSelect } from "@shared/ui-primitives/filter-select";
import { SelectionButton } from "@shared/ui-primitives/selection-button";
import { Button } from "@shared/ui-primitives/button";
import { GameArtwork, OperatorPortrait } from "./GameArtwork";
import { SkillFilters } from "./SkillFilters";
import { SearchInput } from "@shared/ui-primitives/search-input";

const skillCatalog = [...catalog].sort(compareOperatorRelease);

type OperatorPicker = { value: string; unavailable: ReadonlySet<string>; onSelect: (name: string) => void };

/**
 * 一张卡片的四个技能节点：上排 1_1→1_2，下排 2_1→2_2（整体右移）。
 * 点图标切换解锁；高档已解锁时低档与连线一起点亮。
 */
/** 展示数据里的解锁要求（catalog.json 才有这些值，求解器数据缺字段时会当成 0）。 */
function displayUnlock(display: ReturnType<typeof operatorData>, nodeId: string | undefined, fallback: number): number {
  const matched = nodeId ? display?.skills.find(item => item.id === nodeId) : undefined;
  return Number.isFinite(matched?.unlock) ? (matched?.unlock as number) : fallback;
}

function ShipSkillNodes({ skills, latestSpaceshipSkillNodes, elite, display, disabled, onToggle }: {
  skills: (typeof catalog)[number]["skills"];
  latestSpaceshipSkillNodes?: string[];
  elite: number;
  display: ReturnType<typeof operatorData>;
  disabled: boolean;
  onToggle: (nodeId: string) => void;
}) {
  const unlocked = new Set(unlockedSkillNodes(skills, { elite, latestSpaceshipSkillNodes }));
  const bySlot = new Map<number, (typeof skills)[number][]>();
  for (const skill of skills) {
    const match = /^spaceship_skill_.*_(\d+)_(\d+)$/.exec(skill.nodeId ?? "");
    const slot = match ? Number(match[1]) : 0;
    if (!slot) continue;
    const list = bySlot.get(slot) ?? [];
    list.push(skill);
    bySlot.set(slot, list);
  }
  const slots = [...bySlot.entries()]
    .sort(([a], [b]) => a - b)
    .map(([slot, list]) => [slot, list.slice().sort((a, b) => (a.nodeId ?? "").localeCompare(b.nodeId ?? ""))] as const);
  if (!slots.length) return null;
  return (
    <div className="ef-skill-nodes" role="group" aria-label="基建技能解锁">
      {slots.map(([slot, list], row) => (
        <div className="ef-skill-node-row" key={slot} data-row={row}>
          {list.map((skill, index) => {
            const active = unlocked.has(skill.nodeId ?? "");
            const source = display?.skills.find(item => item.id === skill.nodeId)
              ?? display?.skills.find(item => item.name === skill.name);
            const unlock = displayUnlock(display, skill.nodeId, skill.unlock);
            return (
              <Fragment key={skill.nodeId}>
                {index > 0 ? <span className="ef-skill-node-link" data-active={active || undefined} aria-hidden /> : null}
                <button type="button" className="ef-skill-node" data-active={active || undefined} disabled={disabled}
                  aria-pressed={active}
                  title={active ? skill.name : `${skill.name}（需要精英化 ${unlock}）`}
                  onClick={() => onToggle(skill.nodeId ?? "")}>
                  <GameArtwork src={source?.icon} name={skill.name} size={30} />
                  <small>E{unlock}</small>
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
  const [rarity, setRarity] = useState("all");
  const [room, setRoom] = useState("all");
  const [profession, setProfession] = useState("all");
  const [tag, setTag] = useState("all");
  const selected = new Map(workspace.operators.map(op => [op.name, op.elite]));
  const rows = (skillsOnly ? skillCatalog : catalog).filter(op => (!(onlyOwned || picker) || selected.has(op.name)) && (rarity === "all" || op.rarity === Number(rarity))
    && (profession === "all" || op.profession === profession)
    && op.skills.some(skill => (room === "all" || skill.room === room) && (tag === "all" || skill.effectKey === tag))
    && `${op.name} ${op.enName} ${op.skills.map(s => `${s.name} ${s.description}`).join(" ")} ${operatorData(op.id)?.skills.map(s => `${s.enName} ${s.enDescription}`).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()));
  const roomNames: Record<string, string> = { 中枢: "Control center", 总控中枢: "Control center", 制造舱: "Manufacturing", 培养舱: "Growth", 会客室: "Reception", "会客室(线索)": "Reception (clues)" };
  const emptyText = t("没有匹配选项", "No matching options");
  const facilityLabel = (value: string) => locale === "en" ? roomNames[value] || value : value;
  function save(operators: Operator[]) {
    const owned = new Set(operators.map(op => op.name));
    const manual = workspace.manual?.map(room => ({ ...room, a: room.a.map(n => owned.has(n) ? n : ""), b: room.b.map(n => owned.has(n) ? n : "") }));
    update({ ...workspace, operators, ...(manual ? { manual } : {}) });
  }
  /** 判断/切换用的技能表：解锁要求以展示数据为准（求解器数据缺这 18 条）。 */
  function skillTiers(op: (typeof catalog)[number]) {
    const display = operatorData(op.id);
    return op.skills.map(skill => ({ ...skill, unlock: displayUnlock(display, skill.nodeId, skill.unlock) }));
  }

  /** 当前生效的节点：没有字段时按精英化回退，并收敛成每槽最高档。 */
  function currentNodes(op: (typeof catalog)[number], entry: Operator) {
    const tiers = skillTiers(op);
    const nodes = entry.latestSpaceshipSkillNodes
      ?? unlockedSkillNodes(tiers, entry).filter((id) => {
        const parsed = parseSkillNodeId(id);
        const top = tiers
          .map((skill) => parseSkillNodeId(skill.nodeId ?? ""))
          .filter((item): item is { slot: number; level: number } => !!item && item.slot === parsed?.slot)
          .reduce((max, item) => Math.max(max, item.level), 0);
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
  function toggleNode(op: (typeof catalog)[number], nodeId: string) {
    const entry = workspace.operators.find(item => item.name === op.name);
    if (!entry) return;
    const tiers = skillTiers(op);
    if (!tiers.some(skill => skill.nodeId === nodeId)) return;
    const before = currentNodes(op, entry);
    const next = toggleSkillNode(tiers, before, nodeId);
    const elite = requiredElite(tiers, next, entry.elite);
    save(workspace.operators.map(item => item.name === op.name ? { ...item, elite, latestSpaceshipSkillNodes: next } : item));
  }

  /**
   * 修改精英化：调低时把无法解锁的档降到可解锁的最高档（一档都不到则取消该槽）；
   * 调高不补技能。
   */
  function changeElite(op: (typeof catalog)[number], entry: Operator, nextElite: number) {
    const tiers = skillTiers(op);
    const before = currentNodes(op, entry);
    const next = reconcileSkillNodes(tiers, before, nextElite);
    save(workspace.operators.map(item => item.name === op.name
      ? { ...item, elite: nextElite, latestSpaceshipSkillNodes: next.length ? next : [] }
      : item));
  }

  return <div className={embedded ? "ef-roster-editor" : "ef-page"}>
    {!embedded ? <PageTitle title={skillsOnly ? t("帝江号技能", "Ship skills") : t("我的干员", "My operators")} subtitle={skillsOnly ? t("查询干员技能与精英化解锁阶段。", "Browse ship skills and their elite-stage requirements.") : t("只勾选你已拥有的干员，并设置实际精英化阶段。", "Select the operators you own and set their actual elite stages.")}
      meta={skillsOnly ? <span className="ef-muted" aria-live="polite">{t(`${rows.length} 名干员`, `${rows.length} operators`)}</span> : undefined}
      action={!skillsOnly ? <Action variant="dark" icon={<Download />} disabled={!ready} onClick={() => downloadJson("endfield-roster.json", { operators: workspace.operators })}>{t("导出名单", "Export roster")}</Action>
        : <Button type="button" variant="ghost" size="sm" disabled={rarity === "all" && profession === "all" && room === "all" && tag === "all"}
          onClick={() => { setRarity("all"); setProfession("all"); setRoom("all"); setTag("all"); }}><X aria-hidden />{t("清除选择", "Clear filters")}</Button>} /> : null}
    {storageError ? <Notice error>{storageError}</Notice> : null}
    <>
      <SkillFilters rarity={rarity} profession={profession} room={room} tag={tag} onRarityChange={setRarity} onProfessionChange={setProfession}
        onRoomChange={value => { setRoom(value); setTag("all"); }} onTagChange={setTag} facilityLabel={facilityLabel} />
      <SearchInput containerClassName="mt-3" label={t("搜索干员或技能", "Search operators or skills")} placeholder={t("搜索干员、技能名称或效果…", "Search operators, skill names or effects…")} value={query} onChange={e => setQuery(e.target.value)} onClear={() => setQuery("")} clearLabel={t("清空搜索", "Clear search")} />
    </>
    <Section>
      {!skillsOnly ? <div className="ef-roster-toolbar">
        <div className="ef-roster-filters">
          {!picker ? <SelectionButton selected={onlyOwned} onSelectedChange={setOnlyOwned}>{t("仅已选", "Selected only")}</SelectionButton> : null}
          <Button type="button" variant="ghost" size="sm" disabled={rarity === "all" && profession === "all" && room === "all" && tag === "all"}
            onClick={() => { setRarity("all"); setProfession("all"); setRoom("all"); setTag("all"); }}><X aria-hidden />{t("清除选择", "Clear filters")}</Button>
          <span className="ef-roster-count ef-muted" role="status">{picker
            ? t(`显示 ${rows.length} 名 · 仅已拥有干员`, `${rows.length} shown · Owned operators only`)
            : t(`显示 ${rows.length} 名 · 已选 ${selected.size}`, `${rows.length} shown · ${selected.size} selected`)}</span>
        </div>
      </div> : null}
      <div className={`ef-roster-grid ${skillsOnly ? "ef-roster-grid--skills" : "ef-roster-grid--compact"}`}>{rows.map(op => {
        if (picker) {
          const current = picker.value === op.name;
          const unavailable = picker.unavailable.has(op.name);
          return <button key={op.id} type="button" className="ef-roster-card ef-roster-choice" data-operator-id={op.id} data-operator-name={op.name}
            data-selected={current} aria-pressed={current} disabled={!ready || unavailable} onClick={() => picker.onSelect(op.name)}>
            <span className="ef-roster-choice-identity"><OperatorPortrait name={op.id} size={48} />
              <span className="ef-roster-identity"><strong>{locale === "en" ? op.enName : op.name}</strong><span className="ef-roster-rarity">{op.rarity}★ · E{selected.get(op.name)}</span></span>
            </span>
            <span className="ef-roster-choice-status">{current ? <Check size={14} aria-hidden /> : null}{current ? t("当前工位", "Current slot") : unavailable ? t("已安排至其他工位", "Assigned elsewhere") : t("选择干员", "Select operator")}</span>
          </button>;
        }
        const display = operatorData(op.id);
        const ownedOperator = workspace.operators.find(item => item.name === op.name);
        const matchingSkills = op.skills.filter(skill => (room === "all" || skill.room === room) && (tag === "all" || skill.effectKey === tag));
        const facilities = Array.from(new Set(matchingSkills.map(skill => skill.room)));
        const skillList = skillsOnly ? <div className="ef-ship-skills">{facilities.map(facility => <div className="ef-skill-group" key={facility}>
          <p className="ef-skill-facility">{facilityLabel(facility)}</p>
          <div className="ef-skill-variants">{matchingSkills.filter(skill => skill.room === facility).map((skill, i) => {
          const source = display?.skills.find(s => s.id === skill.nodeId) ?? display?.skills.find(s => s.name === skill.name);
          const unlock = displayUnlock(display, skill.nodeId, skill.unlock);
          // 有账号节点数据时以实际解锁为准；否则按精英化估算。
          const owned = workspace.operators.find(item => item.name === op.name);
          const nodes = owned ? new Set(unlockedSkillNodes(skillTiers(op), owned)) : null;
          const locked = nodes ? !(skill.nodeId && nodes.has(skill.nodeId)) : false;
          return <div key={i} className="ef-ship-skill" data-locked={locked || undefined}>
            <GameArtwork src={source?.icon} name={skill.name} size={36} className="ef-skill-artwork" />
            <div><h4>{locale === "en" ? source?.enName || skill.name : skill.name}<small title={t(`精英化 ${unlock} 解锁`, `Unlocked at elite ${unlock}`)}>E{unlock}</small></h4>
              <p>{locale === "en" ? source?.enDescription || skill.description : skill.description}</p></div>
          </div>;
        })}</div></div>)}</div> : null;
        return <article key={op.id} className="ef-roster-card" data-operator-id={op.id} data-selected={selected.has(op.name)}>
          <header><OperatorPortrait name={op.id} size={skillsOnly ? 72 : 48} /><div className="ef-roster-identity"><h3>{locale === "en" ? op.enName : op.name}</h3><p><span className="ef-roster-rarity">{op.rarity}★</span>{skillsOnly ? <span>{locale === "en" ? op.name : op.enName}</span> : null}</p></div>
            {skillsOnly && selected.has(op.name) ? <span className="ef-roster-stage">{t("已拥有", "Owned")} · E{selected.get(op.name)}</span> : null}
            {!skillsOnly ? <SelectionButton selected={selected.has(op.name)} aria-label={t(`拥有${op.name}`, `Own ${op.enName}`)} disabled={!ready} size="icon-sm"
              onSelectedChange={owned => save(owned ? [...workspace.operators, { name: op.name, elite: 0 }] : workspace.operators.filter(x => x.name !== op.name))}>
              {selected.has(op.name) ? <Check aria-hidden /> : <Plus aria-hidden />}
            </SelectionButton> : null}
          </header>
          {!skillsOnly ? <div className="ef-roster-controls"><div className="ef-roster-elite"><label htmlFor={`elite-${op.id}`}>{t("精英化", "Elite stage")}</label><div className="ef-roster-elite-select"><FilterSelect id={`elite-${op.id}`} aria-label={`${op.name} ${t("精英化", "elite stage")}`} value={selected.get(op.name) ?? 0} disabled={!ready || !selected.has(op.name)} onValueChange={value => { const entry = workspace.operators.find(item => item.name === op.name); if (entry) changeElite(op, entry, Number(value)); }} emptyText={emptyText} options={[0,1,2,3,4].map(value => ({ value, label: `E${value}` }))} /></div></div>
            <ShipSkillNodes skills={op.skills} latestSpaceshipSkillNodes={ownedOperator?.latestSpaceshipSkillNodes} elite={ownedOperator?.elite ?? 0} display={display} disabled={!ready || !ownedOperator} onToggle={nodeId => toggleNode(op, nodeId)} />
          </div> : null}
          {skillList}
        </article>;
      })}</div>{rows.length === 0 ? <Notice>{t("没有匹配的干员。", "No matching operators.")}</Notice> : null}
    </Section>
  </div>;
}
