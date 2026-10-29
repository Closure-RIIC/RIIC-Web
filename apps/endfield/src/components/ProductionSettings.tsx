import { gameLabel } from "../i18n/game-labels";
import { Field } from "@riic/endfield-ui";
import { useWorkspace } from "../state";
import { ProductionIcon } from "./GameArtwork";

export function ProductionSettings() {
  const { workspace, update, busy, ready, t } = useWorkspace();
  const options = workspace.options;
  const fieldProps = { disabled: busy || !ready, emptyText: t("ProductionSettings.noMatchingOptions") };
  return <div className="ef-production-settings">
    <Field {...fieldProps} label={t("ProductionSettings.manufacturingLayout")} value={options.mfg}
      onValueChange={value => update({ ...workspace, options: { ...options, mfg: value } })}
      options={["1干员1武器", "2干员", "2武器"].map((value) => ({ value, label: gameLabel(t, value) }))} />
    <div className="ef-form-grid">
      {["晶植", "菌类", "矿物"].map((key) => <Field {...fieldProps} key={key} leading={<ProductionIcon category={key} />} label={gameLabel(t, `${key}培养位`)} value={options.grow[key]}
        onValueChange={value => update({ ...workspace, options: { ...options, grow: { ...options.grow, [key]: Number(value) } } })}
        options={Array.from({ length: options.levels.grow * 3 + 1 }, (_, n) => ({
          value: n, label: String(n),
          disabled: n + Object.entries(options.grow).reduce((total, [kind, value]) => total + (kind === key ? 0 : value), 0) > options.levels.grow * 3,
        }))} />)}
    </div>
    <p className="ef-muted">{t("ProductionSettings.totalGrowthPlots")} {Object.values(options.grow).reduce((a,b) => a+b,0)} / {options.levels.grow * 3}</p>
  </div>;
}
