import { gameLabel } from "../i18n/game-labels";
import { Field, Section } from "@riic/endfield-ui";
import { useWorkspace } from "../state";
import { ProductionSettings } from "./ProductionSettings";
import { RestoreAccountButton } from "./RestoreAccountButton";

export function FacilitySettings() {
  const { workspace, update, busy, ready, t } = useWorkspace();
  const options = workspace.options;
  const fieldProps = { disabled: busy || !ready, emptyText: t("FacilitySettings.noMatchingOptions") };
  function center(level: number) {
    const grow = level >= 5 ? 3 : level >= 3 ? 2 : level >= 2 ? 1 : 0;
    const mfg = level >= 4 ? 3 : level >= 2 ? 2 : 1;
    const guest = level >= 5 ? 3 : level >= 4 ? 2 : level >= 3 ? 1 : 0;
    update({ ...workspace, options: { ...options, levels: { center: level, mfg1: mfg, mfg2: mfg, grow, guest }, grow: { 晶植: grow * 3, 菌类: 0, 矿物: 0 } } });
  }
  return <Section title={t("FacilitySettings.facilitiesProduction")}>
    <p className="ef-settings-description">{t("FacilitySettings.sklandSyncUpdatesFacilityLevelsAdjustProductionAndGrowth")}</p>
    <div className="ef-form-grid" data-facility-settings>
      <Field {...fieldProps} label={t("FacilitySettings.controlCenter")} value={options.levels.center} onValueChange={value => center(Number(value))} options={[1,2,3,4,5].map(n => ({ value: n, label: `Lv.${n}` }))} />
      {(["mfg1", "mfg2", "grow", "guest"] as const).map((key, i) => {
        const c = options.levels.center;
        const max = key.startsWith("mfg") ? c >= 4 ? 3 : c >= 2 ? 2 : 1 : key === "grow" ? c >= 5 ? 3 : c >= 3 ? 2 : c >= 2 ? 1 : 0 : c >= 5 ? 3 : c >= 4 ? 2 : c >= 3 ? 1 : 0;
        const min = key.startsWith("mfg") ? 1 : 0;
        return <Field {...fieldProps} key={key} label={gameLabel(t, ["制造舱 Ⅰ", "制造舱 Ⅱ", "培养舱", "会客室"][i])} value={options.levels[key]} onValueChange={value => {
          const level = Number(value);
          update({ ...workspace, options: { ...options, levels: { ...options.levels, [key]: level }, ...(key === "grow" ? { grow: { 晶植: level * 3, 菌类: 0, 矿物: 0 } } : {}) } });
        }} options={Array.from({ length: max - min + 1 }, (_, j) => ({ value: j + min, label: j + min ? `Lv.${j + min}` : t("FacilitySettings.notBuilt") }))} />;
      })}
    </div>
    <RestoreAccountButton />
    <div className="mt-5"><ProductionSettings /></div>
  </Section>;
}
