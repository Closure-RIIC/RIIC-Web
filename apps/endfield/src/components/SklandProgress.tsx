import { useWorkspace } from "../state";
import styles from "./SklandProgress.module.css";

/** The overview and expanded details share the same values and accessible progress meter. */
export function SklandProgress({ label, current, max, compact = false }: {
  label: string; current: number | null; max: number | null; compact?: boolean;
}) {
  const { t } = useWorkspace();
  const known = current !== null && max !== null && max > 0;
  const percent = known ? Math.min(100, Math.max(0, current / max * 100)) : null;
  return <div className={`${styles.root} ${compact ? styles.compact : ""}`}>
    <div className={styles.summary}>
      <div className={styles.value}><strong>{current ?? "—"}</strong><span>/ {max ?? "—"}</span></div>
      <span className={styles.percent}>{percent === null ? t("暂未获取", "Not available") : `${Math.round(percent)}%`}</span>
    </div>
    {known ? <progress className={styles.bar} value={Math.min(current, max)} max={max} aria-label={label}
      aria-valuetext={`${current} / ${max}`}>{percent}%</progress>
      : <div className={styles.placeholder} aria-hidden="true" />}
    {known && current > max ? <p className={styles.hint}>{t("已超过恢复上限，按实际数值展示。", "Above the recovery cap; the actual value is shown.")}</p> : null}
  </div>;
}
