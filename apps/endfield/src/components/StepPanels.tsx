import { Action, Section } from "@riic/endfield-ui";
import { ScrollArea } from "@riic/ui-primitives/scroll-area";
import { Trash2 } from "lucide-react";
import { useWorkspace } from "../state";
import type { StepLogEntry, StepRoom, StepView } from "../step/step-types.ts";
import { formatClock, formatDuration } from "../step/step-engine.ts";
import { stepLogText } from "../step/step-presentation";
import { gameLabel } from "../i18n/game-labels";
import { operatorName } from "../i18n/game-data";
import { useState } from "react";

export function StepLog({ log, startHour, onClear }: { log: StepLogEntry[]; startHour: number; onClear: () => void }) {
  const { locale, t } = useWorkspace();
  const [selectedPage, setPage] = useState(0);
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(log.length / pageSize));
  const page = Math.min(selectedPage, pageCount - 1);
  const first = page * pageSize;
  return <Section title={t("StepPanels.eventLog")} actions={<Action id="logClearBtn" size="sm" icon={<Trash2 />} disabled={!log.length} onClick={onClear}>{t("StepPanels.clear")}</Action>}>
    <ScrollArea id="logList" className="ef-step-log" viewportProps={{ "aria-label": t("StepPanels.eventLog") }}>
      {log.length ? log.slice(first, first + pageSize).map((entry, index) => <div className="ef-step-log-entry" data-event={entry.type} key={first + index}>
        <time>{formatClock(entry.tSec, startHour)}</time><span>{stepLogText(entry.message, locale, t)}</span>
      </div>) : <p className="ef-muted">{t("StepPanels.noEventsYet")}</p>}
    </ScrollArea>
    {pageCount > 1 ? <div className="ef-actions" aria-label={t("StepPanels.eventLog")}>
      <Action size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>{t("StepPanels.previousEvents")}</Action>
      <span className="ef-muted">{t("StepPanels.eventRange", { from: first + 1, to: Math.min(first + pageSize, log.length), total: log.length })}</span>
      <Action size="sm" disabled={page === pageCount - 1} onClick={() => setPage(page + 1)}>{t("StepPanels.nextEvents")}</Action>
    </div> : null}
  </Section>;
}

export function StepStats({ view, rooms }: { view: StepView; rooms: StepRoom[] }) {
  const { locale, t } = useWorkspace();
  const rows = rooms.filter(room => view.rooms[room.key]).flatMap(room => {
    if (room.key === "中枢") return [];
    const hours = (view.workTimeSec[room.key] ?? 0) / 3600;
    return room.products.map(product => {
      const output = view.output[room.key];
      const total = typeof output === "number" ? output : output?.[product] ?? 0;
      return <tr key={`${room.key}:${product}`}><td>{gameLabel(t, room.key)} · {gameLabel(t, product)}</td>
        <td>{total.toFixed(2)}</td><td>{(hours ? total / hours : 0).toFixed(2)}</td>
        <td>{formatDuration(view.workTimeSec[room.key] ?? 0)}</td></tr>;
    });
  });
  return <div id="statsArea">
    <p className="ef-muted">{t("StepPanels.outputIsMeasuredInEffectiveHoursAverageRateUses")}</p>
    <ScrollArea direction="both" className="ef-table-wrap"><table className="ef-table">
      <caption className="sr-only">{t("StepPanels.facilityProductionStatistics")}</caption>
      <thead><tr><th>{t("StepPanels.facilityProduct")}</th><th>{t("StepPanels.totalOutput")}</th><th>{t("StepPanels.averageH")}</th><th>{t("StepPanels.activeWork")}</th></tr></thead>
      <tbody>{rows}</tbody>
    </table></ScrollArea>
    <details className="ef-details ef-step-mood-stats"><summary>{t("StepPanels.operatorMoraleStatistics")}</summary>
      <ScrollArea direction="both" className="ef-table-wrap"><table className="ef-table">
        <thead><tr><th>{t("StepPanels.operator")}</th><th>{t("StepPanels.minimum")}</th><th>{t("StepPanels.maximum")}</th><th>{t("StepPanels.current")}</th></tr></thead>
        <tbody>{view.ops.map(op => {
          let minimum = view.moodRanges?.[op.name]?.minimum ?? op.mood;
          let maximum = view.moodRanges?.[op.name]?.maximum ?? op.mood;
          for (const sample of view.history) {
            const mood = sample.moods[op.name];
            if (mood === undefined) continue;
            if (mood < minimum) minimum = mood;
            if (mood > maximum) maximum = mood;
          }
          return <tr key={op.name}><td>{operatorName(op.name, locale)}</td><td>{minimum.toFixed(1)}%</td>
            <td>{maximum.toFixed(1)}%</td><td>{op.mood.toFixed(1)}%</td></tr>;
        })}</tbody>
      </table></ScrollArea>
    </details>
  </div>;
}
