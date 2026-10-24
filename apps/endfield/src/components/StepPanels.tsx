import { Action, Section } from "@riic/endfield-ui";
import { Trash2 } from "lucide-react";
import { useWorkspace } from "../state";
import { OperatorPortrait } from "./GameArtwork";
import type { StepLogEntry, StepRoom, StepView } from "../step/step-types.ts";
import { formatClock, formatDuration } from "../step/step-engine.ts";

export function StepRooms({ view, rooms, ratesOf, centralBonus, labelOf }: {
  view: StepView; rooms: StepRoom[]; ratesOf: (key: string) => Record<string, number>;
  centralBonus: number; labelOf: (name: string) => string;
}) {
  const { t } = useWorkspace();
  return <div className="ef-step-live-grid" id="roomsGrid">{rooms.filter(room => view.rooms[room.key]).map(room => {
    const state = view.rooms[room.key];
    const rates = ratesOf(room.key);
    const operators = view.ops.filter(op => op.roomKey === room.key);
    return <article className="ef-result ef-step-live" key={room.key}>
      <header><h3>{room.label}</h3><span className="ef-muted">{state.shiftEnabled
        ? `${state.activeRound === "round1" ? "A" : "B"} ${t("班", "shift")}` : t("单班循环", "Single shift")}</span></header>
      <div className="ef-step-live-body">
        {operators.map(op => {
          const active = op.round === state.activeRound;
          const working = active && op.working;
          const mood = Math.min(100, Math.max(0, op.mood));
          return <div className="ef-step-operator" key={op.name}>
            <OperatorPortrait name={op.name} size={36} />
            <div className="ef-step-operator-info"><div><strong>{labelOf(op.name)}</strong>
              <span className="ef-muted">{working ? t("工作", "Working") : active ? t("休息", "Resting") : t("待命", "Standby")}</span></div>
              <progress max={100} value={mood} data-low={mood < 30 || undefined} aria-label={`${labelOf(op.name)} ${t("心情", "morale")}`} />
            </div><span className="ef-step-number">{mood.toFixed(1)}%</span>
          </div>;
        })}
        {!operators.length ? <p className="ef-muted">{t("未安排干员", "No operators assigned")}</p> : null}
        <dl className="ef-step-metrics">
          {room.key === "中枢" ? <div><dt>{t("心情恢复加成", "Morale recovery bonus")}</dt><dd>+{centralBonus.toFixed(1)}%</dd></div>
            : room.products.map(product => {
              const output = view.output[room.key];
              const total = typeof output === "number" ? output : output?.[product] ?? 0;
              return <div key={product}><dt>{product}</dt><dd>{(rates[product] ?? rates._total ?? 0).toFixed(2)}/h <small className="ef-muted">· {t("累计", "Total")} {total.toFixed(2)}</small></dd></div>;
            })}
          <div><dt>{t("有效工作", "Active work")}</dt><dd>{formatDuration(view.workTimeSec[room.key] ?? 0)}</dd></div>
        </dl>
      </div>
    </article>;
  })}</div>;
}

export function StepLog({ log, startHour, onClear }: { log: StepLogEntry[]; startHour: number; onClear: () => void }) {
  const { t } = useWorkspace();
  return <Section title={t("事件日志", "Event log")} actions={<Action id="logClearBtn" size="sm" icon={<Trash2 />} disabled={!log.length} onClick={onClear}>{t("清空", "Clear")}</Action>}>
    <div id="logList" className="ef-step-log" tabIndex={0} aria-label={t("事件日志", "Event log")}>
      {log.length ? log.map((entry, index) => <div className="ef-step-log-entry" data-event={entry.type} key={index}>
        <time>{formatClock(entry.tSec, startHour)}</time><span>{entry.text.replace(/^[^\p{L}\p{N}]+/u, "")}</span>
      </div>) : <p className="ef-muted">{t("暂无事件", "No events yet")}</p>}
    </div>
  </Section>;
}

export function StepStats({ view, rooms }: { view: StepView; rooms: StepRoom[] }) {
  const { t } = useWorkspace();
  const rows = rooms.filter(room => view.rooms[room.key]).flatMap(room => {
    if (room.key === "中枢") return [];
    const hours = (view.workTimeSec[room.key] ?? 0) / 3600;
    return room.products.map(product => {
      const output = view.output[room.key];
      const total = typeof output === "number" ? output : output?.[product] ?? 0;
      return <tr key={`${room.key}:${product}`}><td>{room.label} · {product}</td>
        <td>{total.toFixed(2)}</td><td>{(hours ? total / hours : 0).toFixed(2)}</td>
        <td>{formatDuration(view.workTimeSec[room.key] ?? 0)}</td></tr>;
    });
  });
  return <div id="statsArea">
    <p className="ef-muted">{t("产出单位为等效小时；均产按有效工作时长计算。", "Output is measured in effective hours; average rate uses active work time.")}</p>
    <div className="ef-table-wrap"><table className="ef-table">
      <caption className="sr-only">{t("设施产出统计", "Facility production statistics")}</caption>
      <thead><tr><th>{t("舱室 / 产物", "Facility / product")}</th><th>{t("累计产出", "Total output")}</th><th>{t("均产 / h", "Average / h")}</th><th>{t("有效工作", "Active work")}</th></tr></thead>
      <tbody>{rows}</tbody>
    </table></div>
    <details className="ef-details ef-step-mood-stats"><summary>{t("干员心情统计", "Operator morale statistics")}</summary>
      <div className="ef-table-wrap"><table className="ef-table">
        <thead><tr><th>{t("干员", "Operator")}</th><th>{t("最低", "Minimum")}</th><th>{t("最高", "Maximum")}</th><th>{t("当前", "Current")}</th></tr></thead>
        <tbody>{view.ops.map(op => {
          const moods = view.history.flatMap(sample => sample.moods[op.name] === undefined ? [] : [sample.moods[op.name]]);
          return <tr key={op.name}><td>{op.name}</td><td>{Math.min(op.mood, ...moods).toFixed(1)}%</td>
            <td>{Math.max(op.mood, ...moods).toFixed(1)}%</td><td>{op.mood.toFixed(1)}%</td></tr>;
        })}</tbody>
      </table></div>
    </details>
  </div>;
}
