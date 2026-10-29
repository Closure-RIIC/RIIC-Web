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
    <Section title={t("StepSettings.timeRange")}>
      <div className="ef-form-grid">
        <Field label={t("StepSettings.duration")} value={controls.maxHours} onValueChange={value => onControls({ ...controls, maxHours: Number(value) })}
          options={SIM_HOURS.map(value => ({ value, label: `${value} h` }))} />
        <label className="ef-field"><span>{t("StepSettings.startHour")}</span>
          <Input type="number" id="startHour" min={0} max={23} value={controls.startHour}
            onChange={event => { if (event.target.value !== "") onControls({ ...controls, startHour: Math.min(23, Math.max(0, Math.round(Number(event.target.value)))) }); }} />
        </label>
        <Field label={t("StepSettings.chartSampling")} value={controls.sampleSec} onValueChange={value => onControls({ ...controls, sampleSec: Number(value) })}
          options={[10, 30, 60, 300, 900].map(value => ({ value, label: value < 60 ? `${value} s` : `${value / 60} min` }))} />
      </div>
    </Section>
    <Section title={t("StepSettings.startingMoraleAndWorkStatus")}>
      <p className="ef-muted">{t("StepSettings.onlyTheActiveShiftCanStartWorkingUncheckedOperators")}</p>
      <div className="ef-step-mood-grid">
        {[...scheduled].map(name => <div key={name} className="ef-step-mood-setting">
          <label className="ef-field"><span>{labelOf(name)} · {t("StepSettings.morale")}</span>
            <Input type="number" min={0} max={100} step={1} value={config.moods[name] ?? 100} data-step-mood={name}
              onChange={event => { if (event.target.value !== "") onMood(name, Math.min(100, Math.max(0, Math.round(Number(event.target.value))))); }} />
          </label>
          <label className="ef-toggle"><input type="checkbox" checked={config.work[name] !== false}
            onChange={event => onWork(name, event.target.checked)} />{t("StepSettings.startWorking")}</label>
        </div>)}
        {!scheduled.size ? <p className="ef-muted">{t("StepSettings.assignOperatorsInTheEditorFirst")}</p> : null}
      </div>
    </Section>
    <Section title={t("StepSettings.moraleAssistance")}>
      <StepBoosts boost={ensureBoostDays(config.boost, days)} maxDays={days} scheduled={scheduled} labelOf={labelOf}
        disabled={false} assistEnabled={workspace.options.assist} onChange={onBoost} onPickTarget={onPick} />
    </Section>
  </div>;
}
