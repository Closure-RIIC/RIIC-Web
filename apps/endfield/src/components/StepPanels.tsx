import { Action, Section } from "@riic/endfield-ui";
import { ScrollArea } from "@riic/ui-primitives/scroll-area";
import { Trash2 } from "lucide-react";
import { useWorkspace } from "../state";
import type { StepLogEntry, StepRoom, StepView } from "../step/step-types.ts";
import { formatClock, formatDuration } from "../step/step-engine.ts";

export function StepLog({ log, startHour, onClear }: { log: StepLogEntry[]; startHour: number; onClear: () => void }) {
  const { t } = useWorkspace();
  return <Section title={t("事件日志", "Event log")} actions={<Action id="logClearBtn" size="sm" icon={<Trash2 />} disabled={!log.length} onClick={onClear}>{t("清空", "Clear")}</Action>}>
    <ScrollArea id="logList" className="ef-step-log" viewportProps={{ "aria-label": t("事件日志", "Event log") }}>
      {log.length ? log.map((entry, index) => <div className="ef-step-log-entry" data-event={entry.type} key={index}>
        <time>{formatClock(entry.tSec, startHour)}</time><span>{entry.text.replace(/^[^\p{L}\p{N}]+/u, "")}</span>
      </div>) : <p className="ef-muted">{t("暂无事件", "No events yet")}</p>}
    </ScrollArea>
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
    <ScrollArea direction="both" className="ef-table-wrap"><table className="ef-table">
      <caption className="sr-only">{t("设施产出统计", "Facility production statistics")}</caption>
      <thead><tr><th>{t("舱室 / 产物", "Facility / product")}</th><th>{t("累计产出", "Total output")}</th><th>{t("均产 / h", "Average / h")}</th><th>{t("有效工作", "Active work")}</th></tr></thead>
      <tbody>{rows}</tbody>
    </table></ScrollArea>
    <details className="ef-details ef-step-mood-stats"><summary>{t("干员心情统计", "Operator morale statistics")}</summary>
      <ScrollArea direction="both" className="ef-table-wrap"><table className="ef-table">
        <thead><tr><th>{t("干员", "Operator")}</th><th>{t("最低", "Minimum")}</th><th>{t("最高", "Maximum")}</th><th>{t("当前", "Current")}</th></tr></thead>
        <tbody>{view.ops.map(op => {
          let minimum = op.mood;
          let maximum = op.mood;
          for (const sample of view.history) {
            const mood = sample.moods[op.name];
            if (mood === undefined) continue;
            if (mood < minimum) minimum = mood;
            if (mood > maximum) maximum = mood;
          }
          return <tr key={op.name}><td>{op.name}</td><td>{minimum.toFixed(1)}%</td>
            <td>{maximum.toFixed(1)}%</td><td>{op.mood.toFixed(1)}%</td></tr>;
        })}</tbody>
      </table></ScrollArea>
    </details>
  </div>;
}
