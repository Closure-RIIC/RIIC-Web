import type { StepBoostConfig } from "../step/step-types.ts";
import { createBoostEntry } from "../step/step-model.ts";

export interface StepBoostsProps {
  boost: StepBoostConfig;
  maxDays: number;
  scheduled: ReadonlySet<string>;
  labelOf: (name: string) => string;
  disabled: boolean;
  assistEnabled: boolean;
  onChange: (next: StepBoostConfig) => void;
  onPickTarget: (dayIndex: number, entryIndex: number) => void;
}

/** 按天独立配置的心情恢复助力；每次 +30%，最多 2 次/日。 */
export function StepBoosts({ boost, maxDays, scheduled, labelOf, disabled, assistEnabled, onChange, onPickTarget }: StepBoostsProps) {
  const dayIndex = Math.min(boost.currentDay, Math.max(0, boost.days.length - 1));
  const day = boost.days[dayIndex] ?? { list: [] };

  function patch(next: Partial<StepBoostConfig>) {
    onChange({ ...boost, ...next });
  }
  function patchEntry(index: number, entry: Partial<{ hour: number; minute: number; target: string | null }>) {
    const days = boost.days.map((item, position) => position === dayIndex
      ? { list: item.list.map((current, entryIndex) => entryIndex === index ? { ...current, ...entry } : current) }
      : item);
    onChange({ ...boost, days });
  }

  return <div className="step-boost-settings">
    <label className="boost-count-label">每天可用次数：
      <select id="dailyBoostCount" value={boost.dailyCount} disabled={disabled}
        onChange={event => {
          const dailyCount: 0 | 1 | 2 = Number(event.target.value) === 1 ? 1 : Number(event.target.value) === 2 ? 2 : 0;
          const days = boost.days.map(item => {
            const list = item.list.slice(0, dailyCount);
            while (list.length < dailyCount) list.push(createBoostEntry(list.length));
            return { list };
          });
          onChange({ ...boost, dailyCount, days });
        }}>
        <option value="0">0 次</option>
        <option value="1">1 次</option>
        <option value="2">2 次</option>
      </select>
    </label>
    <span className="boost-hint">（每次助力使目标心情 +30%，不超 100%；可分别设置第 1~{maxDays} 天，仅可选已排班干员）</span>
    {!assistEnabled ? <span className="boost-hint">· 当前排班未开启“中枢助力”，这里的设置只用于本页推演。</span> : null}
    <div className="boost-day-tabs" id="boostDayTabs">
      {Array.from({ length: maxDays }, (_, index) => <button key={index} type="button"
        className={`boost-day-tab${index === dayIndex ? " active" : ""}`} data-day={index} disabled={disabled}
        onClick={() => patch({ currentDay: index })}>第 {index + 1} 天</button>)}
    </div>
    <div id="boostConfigList" className="boost-config-list">
      {Array.from({ length: boost.dailyCount }, (_, index) => {
        const entry = day.list[index] ?? createBoostEntry(index);
        const valid = !!entry.target && scheduled.has(entry.target);
        return <div className="boost-config-row" key={index}>
          <span>第 {index + 1} 次助力：</span>
          <input type="number" className="boost-hour" data-idx={index} min={0} max={23} value={entry.hour} disabled={disabled}
            onChange={event => { if (event.target.value === "") return; patchEntry(index, { hour: Math.min(23, Math.max(0, Math.round(Number(event.target.value)))) }); }} /> 时
          <input type="number" className="boost-minute" data-idx={index} min={0} max={59} value={entry.minute} disabled={disabled}
            onChange={event => { if (event.target.value === "") return; patchEntry(index, { minute: Math.min(59, Math.max(0, Math.round(Number(event.target.value)))) }); }} /> 分
          <button type="button" className={`boost-target-btn${valid ? " has-target" : ""}`} data-idx={index} disabled={disabled}
            onClick={() => onPickTarget(dayIndex, index)}>{valid ? labelOf(entry.target as string) : "选择干员"}</button>
          {valid ? <span className="boost-target-level">（已排班）</span> : null}
        </div>;
      })}
      {boost.dailyCount === 0 ? <div style={{ fontSize: "0.8rem", color: "#888" }}>未启用助力：需要时把“每天可用次数”调到 1 或 2。</div> : null}
    </div>
  </div>;
}
