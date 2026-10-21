import { Field } from "@riic/endfield-ui";
import { useWorkspace } from "../state";
import { ProductionIcon } from "./GameArtwork";

export function ProductionSettings() {
  const { workspace, update, busy, ready, t } = useWorkspace();
  const options = workspace.options;
  const fieldProps = { disabled: busy || !ready, emptyText: t("没有匹配选项", "No matching options") };
  return <div className="ef-production-settings">
    <Field {...fieldProps} label={t("制造舱布局", "Manufacturing layout")} value={options.mfg}
      onValueChange={value => update({ ...workspace, options: { ...options, mfg: value } })}
      options={["1干员1武器", "2干员", "2武器"].map((value, i) => ({ value, label: t(value, ["1 operator / 1 weapon", "2 operator EXP", "2 weapon EXP"][i]) }))} />
    <div className="ef-form-grid">
      {["晶植", "菌类", "矿物"].map((key, i) => <Field {...fieldProps} key={key} leading={<ProductionIcon category={key} />} label={t(`${key}培养位`, ["Crystal plots", "Fungus plots", "Mineral plots"][i])} value={options.grow[key]}
        onValueChange={value => update({ ...workspace, options: { ...options, grow: { ...options.grow, [key]: Number(value) } } })}
        options={Array.from({ length: options.levels.grow * 3 + 1 }, (_, n) => ({
          value: n, label: String(n),
          disabled: n + Object.entries(options.grow).reduce((total, [kind, value]) => total + (kind === key ? 0 : value), 0) > options.levels.grow * 3,
        }))} />)}
    </div>
    <p className="ef-muted">{t("培养位总数", "Total growth plots")} {Object.values(options.grow).reduce((a,b) => a+b,0)} / {options.levels.grow * 3}</p>
  </div>;
}
