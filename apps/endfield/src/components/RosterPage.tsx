import { useState } from "react";
import { Download, Check, Plus, X } from "lucide-react";
import { catalog, type Operator } from "@shared/endfield-solver/model.mjs";
import { Action, Notice, PageTitle, Section } from "@shared/endfield-ui";
import { downloadJson, useWorkspace } from "../state";
import { compareOperatorRelease, operatorData } from "@shared/endfield-data";
import { SearchInput } from "@shared/ui-primitives/search-input";
import { FilterSelect } from "@shared/ui-primitives/filter-select";
import { SelectionButton } from "@shared/ui-primitives/selection-button";
import { Button } from "@shared/ui-primitives/button";
import { GameArtwork, OperatorPortrait } from "./GameArtwork";
import { SkillFilters } from "./SkillFilters";

const skillCatalog = [...catalog].sort(compareOperatorRelease);

type OperatorPicker = { value: string; unavailable: ReadonlySet<string>; onSelect: (name: string) => void };

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
        const matchingSkills = op.skills.filter(skill => (room === "all" || skill.room === room) && (tag === "all" || skill.effectKey === tag));
        const facilities = Array.from(new Set(matchingSkills.map(skill => skill.room)));
        const skillList = skillsOnly ? <div className="ef-ship-skills">{facilities.map(facility => <div className="ef-skill-group" key={facility}>
          <p className="ef-skill-facility">{facilityLabel(facility)}</p>
          <div className="ef-skill-variants">{matchingSkills.filter(skill => skill.room === facility).map((skill, i) => {
          const source = display?.skills.find(s => s.name === skill.name && s.unlock === skill.unlock) ?? display?.skills.find(s => s.name === skill.name);
          const unlock = source?.unlock ?? skill.unlock;
          return <div key={i} className="ef-ship-skill" data-locked={selected.has(op.name) && (selected.get(op.name) ?? 0) < unlock || undefined}>
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
          {!skillsOnly ? <div className="ef-roster-controls"><div className="ef-roster-elite"><label htmlFor={`elite-${op.id}`}>{t("精英化", "Elite stage")}</label><FilterSelect id={`elite-${op.id}`} aria-label={`${op.name} ${t("精英化", "elite stage")}`} value={selected.get(op.name) ?? 0} disabled={!ready || !selected.has(op.name)} onValueChange={value => save(workspace.operators.map(x => x.name === op.name ? { ...x, elite: Number(value) } : x))} emptyText={emptyText} options={[0,1,2,3,4].map(value => ({ value, label: `E${value}` }))} /></div></div> : null}
          {skillList}
        </article>;
      })}</div>{rows.length === 0 ? <Notice>{t("没有匹配的干员。", "No matching operators.")}</Notice> : null}
    </Section>
  </div>;
}
