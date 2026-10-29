import { useEndfieldLanguage } from "../i18n/client";
import styles from "./SklandProgress.module.css";

/** The overview and expanded details share the same values and accessible progress meter. */
export function SklandProgress({ label, current, max, compact = false }: {
  label: string; current: number | null; max: number | null; compact?: boolean;
}) {
  const { t } = useEndfieldLanguage();
  const known = current !== null && max !== null && max > 0;
  const percent = known ? Math.min(100, Math.max(0, current / max * 100)) : null;
  return <div className={`${styles.root} ${compact ? styles.compact : ""}`}>
    <div className={styles.summary}>
      <div className={styles.value}><strong>{current ?? "—"}</strong><span>/ {max ?? "—"}</span></div>
      <span className={styles.percent}>{percent === null ? t("SklandProgress.notAvailable") : `${Math.round(percent)}%`}</span>
    </div>
    {known ? <progress className={styles.bar} value={Math.min(current, max)} max={max} aria-label={label}
      aria-valuetext={`${current} / ${max}`}>{percent}%</progress>
      : <div className={styles.placeholder} aria-hidden="true" />}
    {known && current > max ? <p className={styles.hint}>{t("SklandProgress.aboveTheRecoveryCapTheActualValueIsShown")}</p> : null}
  </div>;
}
