import { useMemo, useState } from "react";

export interface PickerOperator {
  name: string;
  elite: number;
  rarity: number;
  profession: string;
  icon?: string;
}

export interface StepPickerProps {
  open: boolean;
  title: string;
  operators: PickerOperator[];
  current: string | null;
  unavailable: ReadonlySet<string>;
  scheduled: ReadonlySet<string>;
  /** 助力目标只能从已排班干员里选。 */
  boostOnly: boolean;
  showImages: boolean;
  onSelect: (name: string) => void;
  onClear: () => void;
  onClose: () => void;
}

/** 干员选择弹窗；视觉沿用 step.css 的 `.modal-overlay` / `.picker-*`。 */
export function StepPicker({
  open, title, operators, current, unavailable, scheduled, boostOnly, showImages, onSelect, onClear, onClose,
}: StepPickerProps) {
  const [star, setStar] = useState("all");
  const [profession, setProfession] = useState("all");
  const professions = useMemo(
    () => [...new Set(operators.map(operator => operator.profession).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN")),
    [operators],
  );
  const rows = operators.filter(operator => {
    if (boostOnly && !scheduled.has(operator.name)) return false;
    if (star !== "all" && String(operator.rarity) !== star) return false;
    if (profession !== "all" && operator.profession !== profession) return false;
    return true;
  });

  return <div className={`modal-overlay${open ? " open" : ""}`} id="opPickerOverlay"
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="picker-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="picker-header">
        <h2 id="opPickerTitle">{title}</h2>
        <button className="close-btn" id="opPickerCloseBtn" type="button" onClick={onClose}>✕</button>
      </div>
      <div className="picker-filter-bar">
        <div className="picker-filter-group">
          <label htmlFor="opStarFilter">星级</label>
          <select id="opStarFilter" value={star} onChange={event => setStar(event.target.value)}>
            <option value="all">全部</option>
            <option value="6">六星</option>
            <option value="5">五星</option>
            <option value="4">四星</option>
          </select>
        </div>
        <div className="picker-filter-group">
          <label htmlFor="opAttrFilter">职业</label>
          <select id="opAttrFilter" value={profession} onChange={event => setProfession(event.target.value)}>
            <option value="all">全部</option>
            {professions.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
        <div className="picker-filter-actions">
          <button id="opClearBtn" type="button" onClick={onClear}>移除当前</button>
        </div>
      </div>
      <div className="picker-grid" id="opPickerGrid">
        {rows.length === 0 ? <div style={{ gridColumn: "1/-1", textAlign: "center", color: "#888", padding: "30px 0" }}>没有符合条件的干员</div> : null}
        {rows.map(operator => {
          const selected = operator.name === current;
          const assigned = !boostOnly && !selected && unavailable.has(operator.name);
          const classes = ["picker-card", selected ? "is-selected" : "", assigned ? "is-scheduled" : ""].filter(Boolean).join(" ");
          return <div key={operator.name} className={classes} data-name={operator.name}
            role="button" tabIndex={0} aria-pressed={selected}
            onClick={() => onSelect(operator.name)}
            onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(operator.name); } }}>
            <div className="picker-elite">E{operator.elite}</div>
            {assigned ? <div className="picker-scheduled-tag">已排</div> : null}
            {operator.icon && showImages
              ? <img className="picker-avatar" src={operator.icon} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = "none"; }} />
              : <div className="picker-avatar" aria-hidden="true" />}
            <div className="picker-name">{operator.name}</div>
          </div>;
        })}
      </div>
    </div>
  </div>;
}
