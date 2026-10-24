import type { StepLogEntry, StepRoom, StepView } from "../step/step-types.ts";
import { formatClock, formatDuration } from "../step/step-engine.ts";

export interface StepRoomsProps {
  view: StepView;
  rooms: StepRoom[];
  ratesOf: (key: string) => Record<string, number>;
  centralBonus: number;
  labelOf: (name: string) => string;
  iconOf: (name: string) => string | undefined;
  showImages: boolean;
}

/** ③ 舱室实时状态。 */
export function StepRooms({ view, rooms, ratesOf, centralBonus, labelOf, iconOf, showImages }: StepRoomsProps) {
  if (!view.ops.length) return <div className="rooms-grid"><div className="rooms-placeholder">尚未开始</div></div>;
  return <div className="rooms-grid" id="roomsGrid">
    {Object.keys(view.rooms).map(key => {
      const state = view.rooms[key];
      const config = rooms.find(room => room.key === key);
      if (!config) return null;
      const rates = ratesOf(key);
      const operators = view.ops.filter(op => op.roomKey === key);
      const rows = operators.map(op => {
        const active = op.round === state.activeRound;
        const working = active && op.working;
        const mood = Math.min(100, Math.max(0, op.mood));
        const status = working ? "工作" : active ? "休息" : "待命";
        const icon = iconOf(op.name);
        return <div className="op-row" key={op.name}>
          {icon && showImages
            ? <img className={`op-avatar${working ? "" : " inactive"}`} src={icon} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = "none"; }} />
            : <span className={`op-avatar${working ? "" : " inactive"}`} aria-hidden="true" style={{ display: "inline-block" }} />}
          <span className="op-name">{labelOf(op.name)}{op.round === "round2" ? <span style={{ fontSize: "0.62rem", color: "#b0885a" }}>Ⅱ</span> : null}</span>
          <div className="op-mood-bar"><div className={`op-mood-fill${mood < 30 ? " low" : ""}`} style={{ width: `${mood.toFixed(2)}%` }} /></div>
          <span className="op-mood-text">{mood.toFixed(1)}%</span>
          <span className={`op-status ${working ? "working" : "resting"}`}>{status}</span>
        </div>;
      });

      let footer;
      if (key === "中枢") {
        footer = <span>总控恢复 <span className="stat-val">+{centralBonus}%</span>/h</span>;
      } else if (key === "培养舱") {
        const output = (view.output[key] ?? {}) as Record<string, number>;
        footer = <>
          {config.products.map(product => <span key={product}>{product} <span className="stat-val">{(rates[product] ?? 0).toFixed(2)}</span>/h，累计 <span className="stat-val">{(output[product] ?? 0).toFixed(2)}</span></span>)}
          <span>有效 <span className="stat-val">{formatDuration(view.workTimeSec[key] ?? 0)}</span></span>
        </>;
      } else {
        const output = (view.output[key] as number | undefined) ?? 0;
        const hours = (view.workTimeSec[key] ?? 0) / 3600;
        footer = <>
          <span>产率 <span className="stat-val">{(rates._total ?? 0).toFixed(2)}</span></span>
          <span>累计 <span className="stat-val">{output.toFixed(2)}</span></span>
          <span>均产 <span className="stat-val">{(hours > 0 ? output / hours : 0).toFixed(2)}</span>/h</span>
          <span>有效 <span className="stat-val">{formatDuration(view.workTimeSec[key] ?? 0)}</span></span>
        </>;
      }

      return <div className="room-card" key={key}>
        <div className="room-card-header">
          <div>
            <span className="room-card-title">{config.label}</span>
            {state.shiftEnabled
              ? <span className={`room-card-round${state.activeRound === "round2" ? " round2" : ""}`}>{state.activeRound === "round1" ? "一轮" : "二轮"}</span>
              : <span className="room-card-round">不轮班</span>}
          </div>
        </div>
        {rows.length ? rows : <div style={{ fontSize: "0.72rem", color: "#999", textAlign: "center", padding: "6px 0" }}>空舱</div>}
        <div className="room-card-footer">{footer}</div>
      </div>;
    })}
  </div>;
}

/** ④ 事件日志。 */
export function StepLog({ log, startHour, onClear }: { log: StepLogEntry[]; startHour: number; onClear: () => void }) {
  const className = (entry: StepLogEntry) => {
    if (entry.type === "switch") return "log-line log-switch";
    if (entry.type === "end") return "log-line log-success";
    if (entry.type === "mood-zero") return "log-line log-warn";
    if (entry.type === "boost") return "log-line log-boost";
    return "log-line";
  };
  return <>
    <div className="step-panel-header" style={{ marginBottom: 8 }}>
      <h2>④ 事件日志</h2>
      <button className="step-btn-secondary" id="logClearBtn" type="button" onClick={onClear}>清空</button>
    </div>
    <div id="logList" className="log-list">
      {log.length === 0 ? <div className="log-empty">暂无事件</div> : log.map((entry, index) =>
        <div className={className(entry)} key={index}>
          <span className="log-time">[{formatClock(entry.tSec, startHour)}]</span><span>{entry.text}</span>
        </div>)}
    </div>
  </>;
}

/** ⑤ 最终统计。 */
export function StepStats({ view, rooms }: { view: StepView; rooms: StepRoom[] }) {
  if (!view.ops.length) return <div className="stats-area" id="statsArea"><div className="stats-placeholder">尚未开始</div></div>;

  const rows = Object.keys(view.rooms).flatMap(key => {
    const config = rooms.find(room => room.key === key);
    if (!config) return [];
    const output = view.output[key];
    const hours = (view.workTimeSec[key] ?? 0) / 3600;
    if (key === "中枢") {
      const recovery = view.history.at(-1)?.rates[key]?._total ?? 0;
      return [<tr key={key}><td>{config.label}</td><td className="num">—</td><td className="num">—</td><td className="num">+{recovery.toFixed(0)}%/h</td><td className="num">{formatDuration(view.workTimeSec[key] ?? 0)}</td></tr>];
    }
    if (key === "培养舱") {
      const values = (output ?? {}) as Record<string, number>;
      const lines = config.products.map(product => `${product}：${(values[product] ?? 0).toFixed(2)}（${(hours > 0 ? (values[product] ?? 0) / hours : 0).toFixed(2)}/h）`);
      return [<tr key={key}><td>{config.label}</td><td className="num" colSpan={2}>{lines.join(" / ")}</td><td className="num">—</td><td className="num">{formatDuration(view.workTimeSec[key] ?? 0)}</td></tr>];
    }
    const total = (output as number | undefined) ?? 0;
    return [<tr key={key}><td>{config.label}</td><td className="num">{total.toFixed(2)}</td><td className="num">{(hours > 0 ? total / hours : 0).toFixed(2)}/h</td><td className="num">—</td><td className="num">{formatDuration(view.workTimeSec[key] ?? 0)}</td></tr>];
  });

  const operatorRows = view.ops.map(op => {
    let min = 100;
    let max = 0;
    for (const sample of view.history) {
      const mood = sample.moods[op.name];
      if (mood === undefined) continue;
      if (mood < min) min = mood;
      if (mood > max) max = mood;
    }
    const config = rooms.find(room => room.key === op.roomKey);
    return <tr key={op.name}>
      <td>{op.name}（{config?.label ?? op.roomKey}）</td>
      <td className="num">{min.toFixed(1)}%</td>
      <td className="num">{max.toFixed(1)}%</td>
      <td className="num">{op.mood.toFixed(1)}%</td>
    </tr>;
  });

  return <div className="stats-area" id="statsArea">
    <table className="stats-table">
      <thead><tr><th>舱室</th><th>总产出</th><th>均产</th><th>恢复 / 产率</th><th>有效工作</th></tr></thead>
      <tbody>{rows}</tbody>
    </table>
    <div style={{ marginTop: 14, fontSize: "0.8rem", color: "#2a5a4a", fontWeight: 700 }}>干员心情</div>
    <table className="stats-table" style={{ marginTop: 4 }}>
      <thead><tr><th>干员</th><th>最低</th><th>最高</th><th>结束</th></tr></thead>
      <tbody>{operatorRows}</tbody>
    </table>
  </div>;
}
