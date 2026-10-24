import { Field, Section } from "@riic/endfield-ui";
import { Input } from "@riic/ui-primitives/input";
import { useWorkspace } from "../state";
import type { StepControls } from "../step/step-store.ts";
import type { StepBoostConfig, StepConfig } from "../step/step-types.ts";
import { ensureBoostDays, maxBoostDays } from "../step/step-model.ts";
import { StepBoosts } from "./StepBoosts";
import { SIM_HOURS } from "../mood-simulation/constants";

export function StepSettings({ config, controls, scheduled, labelOf, onControls, onMood, onWork, onBoost, onPick }: {
  config: StepConfig; controls: StepControls; scheduled: ReadonlySet<string>; labelOf: (name: string) => string;
  onControls: (controls: StepControls) => void; onMood: (name: string, value: number) => void;
  onWork: (name: string, value: boolean) => void; onBoost: (boost: StepBoostConfig) => void; onPick: (day: number, index: number) => void;
}) {
  const { workspace, t } = useWorkspace();
  const days = maxBoostDays(controls.startHour, controls.maxHours);
  return <div className="ef-step-page">
    <Section title={t("时间范围", "Time range")}>
      <div className="ef-form-grid">
        <Field label={t("模拟时长", "Duration")} value={controls.maxHours} onValueChange={value => onControls({ ...controls, maxHours: Number(value) })}
          options={SIM_HOURS.map(value => ({ value, label: `${value} h` }))} />
        <label className="ef-field"><span>{t("起点（小时）", "Start hour")}</span>
          <Input type="number" id="startHour" min={0} max={23} value={controls.startHour}
            onChange={event => { if (event.target.value !== "") onControls({ ...controls, startHour: Math.min(23, Math.max(0, Math.round(Number(event.target.value)))) }); }} />
        </label>
        <Field label={t("曲线采样", "Chart sampling")} value={controls.sampleSec} onValueChange={value => onControls({ ...controls, sampleSec: Number(value) })}
          options={[10, 30, 60, 300, 900].map(value => ({ value, label: value < 60 ? `${value} s` : `${value / 60} min` }))} />
      </div>
    </Section>
    <Section title={t("初始心情与工作状态", "Starting morale and work status")}>
      <p className="ef-muted">{t("仅当前班次的干员可以起始工作；未勾选时从休息状态开始。", "Only the active shift can start working. Unchecked operators start resting.")}</p>
      <div className="ef-step-mood-grid">
        {[...scheduled].map(name => <div key={name} className="ef-step-mood-setting">
          <label className="ef-field"><span>{labelOf(name)} · {t("心情 %", "Morale %")}</span>
            <Input type="number" min={0} max={100} step={1} value={config.moods[name] ?? 100} data-step-mood={name}
              onChange={event => { if (event.target.value !== "") onMood(name, Math.min(100, Math.max(0, Math.round(Number(event.target.value))))); }} />
          </label>
          <label className="ef-toggle"><input type="checkbox" checked={config.work[name] !== false}
            onChange={event => onWork(name, event.target.checked)} />{t("起始工作", "Start working")}</label>
        </div>)}
        {!scheduled.size ? <p className="ef-muted">{t("请先在编辑视图安排干员。", "Assign operators in the editor first.")}</p> : null}
      </div>
    </Section>
    <Section title={t("心情恢复助力", "Morale assistance")}>
      <StepBoosts boost={ensureBoostDays(config.boost, days)} maxDays={days} scheduled={scheduled} labelOf={labelOf}
        disabled={false} assistEnabled={workspace.options.assist} onChange={onBoost} onPickTarget={onPick} />
    </Section>
  </div>;
}
