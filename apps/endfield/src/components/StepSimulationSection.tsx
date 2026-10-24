import { lazy, Suspense, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useWorkspace } from "../state";

/**
 * 排班结果下方的心情模拟区（步进模拟）。
 * 与方舟手动排班页的心情模拟一致：折叠面板，展开才加载引擎与图表。
 */
const StepPage = lazy(() => import("./StepPage").then(module => ({ default: module.StepPage })));

export function StepSimulationSection() {
  const { t, result, ready } = useWorkspace();
  const [open, setOpen] = useState(false);
  const disabled = !ready || !result?.center;

  return <section className={`ef-step-section${open ? " is-open" : ""}`} data-step-simulation>
    <button type="button" className="ef-step-toggle" aria-expanded={open} disabled={disabled}
      onClick={() => setOpen(value => !value)}>
      <span>{t("心情模拟", "Morale simulation")}</span>
      <span className="ef-muted">{disabled ? t("生成排班后可模拟", "Generate a schedule first") : t("按当前排班推演 24–96 小时的心情与产出", "Replay 24–96 hours of morale and output for this schedule")}</span>
      <ChevronDown aria-hidden className="ef-step-chevron" />
    </button>
    {open && !disabled ? <div className="ef-step-body">
      <Suspense fallback={<p className="ef-muted" role="status">{t("正在加载模拟引擎…", "Loading simulation…")}</p>}>
        <StepPage />
      </Suspense>
    </div> : null}
  </section>;
}
