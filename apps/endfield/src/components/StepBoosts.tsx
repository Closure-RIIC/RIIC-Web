import { Action, Field, Notice } from "@riic/endfield-ui";
import { Input } from "@riic/ui-primitives/input";
import { Tabs, CompactTabsList, TabsTrigger, TabsContent } from "@riic/ui-primitives/tabs";
import { useWorkspace } from "../state";
import type { StepBoostConfig } from "../step/step-types.ts";
import { createBoostEntry } from "../step/step-model.ts";

export interface StepBoostsProps {
  boost: StepBoostConfig; maxDays: number; scheduled: ReadonlySet<string>;
  labelOf: (name: string) => string; disabled: boolean; assistEnabled: boolean;
  onChange: (next: StepBoostConfig) => void; onPickTarget: (dayIndex: number, entryIndex: number) => void;
}

export function StepBoosts({ boost, maxDays, scheduled, labelOf, disabled, assistEnabled, onChange, onPickTarget }: StepBoostsProps) {
  const { t } = useWorkspace();
  const dayIndex = Math.min(boost.currentDay, Math.max(0, maxDays - 1));
  function changeCount(value: string | number) {
    const dailyCount = Number(value) as 0 | 1 | 2;
    const days = boost.days.map(day => {
      const list = day.list.slice(0, dailyCount);
      while (list.length < dailyCount) list.push(createBoostEntry(list.length));
      return { list };
    });
    onChange({ ...boost, dailyCount, days });
  }
  function patchEntry(dayIndex: number, index: number, patch: Partial<{ hour: number; minute: number }>) {
    const days = boost.days.map((day, i) => i === dayIndex ? {
      list: day.list.map((entry, j) => j === index ? { ...entry, ...patch } : entry),
    } : day);
    onChange({ ...boost, days });
  }
  return <div className="ef-step-boost">
    <div className="ef-step-boost-summary">
      <Field label={t("StepBoosts.assistsPerDay")} value={boost.dailyCount} disabled={disabled}
        onValueChange={changeCount} options={[0, 1, 2].map(value => ({ value, label: t("Game.times", { count: value }) }))} />
      <p className="ef-muted">{t("StepBoosts.eachAssistRestores30MoraleUpTo100Only")}</p>
    </div>
    {!assistEnabled ? <Notice>{t("StepBoosts.centralAssistanceIsOffInTheWorkspaceTheseSettings")}</Notice> : null}
    {boost.dailyCount ? <Tabs value={dayIndex} onValueChange={value => onChange({ ...boost, currentDay: Number(value) })}>
      <CompactTabsList aria-label={t("StepBoosts.assistanceDay")}>{Array.from({ length: maxDays }, (_, index) =>
        <TabsTrigger key={index} value={index} disabled={disabled}>{t("StepBoosts.day", { value1: index + 1 })}</TabsTrigger>)}</CompactTabsList>
      {Array.from({ length: maxDays }, (_, day) => <TabsContent key={day} value={day}>
        <div className="ef-step-boost-entries">{Array.from({ length: boost.dailyCount }, (_, index) => {
          const entry = boost.days[day]?.list[index] ?? createBoostEntry(index);
          const valid = !!entry.target && scheduled.has(entry.target);
          return <fieldset key={index} disabled={disabled} className="ef-step-boost-entry">
            <legend>{t("StepBoosts.assist", { value1: index + 1 })}</legend>
            <label className="ef-field"><span>{t("StepBoosts.time")}</span>
              <Input type="time" step={60} value={`${String(entry.hour).padStart(2, "0")}:${String(entry.minute).padStart(2, "0")}`}
                onChange={event => { const [hour, minute] = event.target.value.split(":").map(Number); if (Number.isFinite(hour) && Number.isFinite(minute)) patchEntry(day, index, { hour, minute }); }} />
            </label>
            <Action size="sm" disabled={disabled} onClick={() => onPickTarget(day, index)}>{valid ? labelOf(entry.target!) : t("StepBoosts.chooseTarget")}</Action>
          </fieldset>;
        })}</div>
      </TabsContent>)}
    </Tabs> : <p className="ef-muted">{t("StepBoosts.noAssistanceInThisSimulation")}</p>}
  </div>;
}
