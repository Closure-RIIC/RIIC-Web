import { useTranslations } from "use-intl";
import { SelectionButton } from "@riic/ui-primitives/selection-button";
import {
  DEFENSE_CORE_BONDS,
  DEFENSE_ADDON_BONDS,
  type DefenseFaction,
  coreBondCount,
  CORE_BOND_MAX,
  validCoreBondSelection,
} from "../../defense-team-validation";
import { DefenseFactionIcon } from "./DefenseFactionIcon";
import styles from "./DefenseBondPicker.module.css";

export function DefenseBondPicker({
  value,
  onChange,
  disabled = false,
  compact = false,
  enforceCoreBounds = false,
}: {
  value: readonly DefenseFaction[];
  onChange: (value: DefenseFaction[]) => void;
  disabled?: boolean;
  compact?: boolean;
  enforceCoreBounds?: boolean;
}) {
  const t = useTranslations("DefenseTeam");
  const coreCount = coreBondCount(value);
  return (
    <div className={`${styles.groups} ${compact ? styles.compact : ""}`}>
      {[
        {
          key: "coreBonds" as const,
          caption: "CORE BONDS",
          values: DEFENSE_CORE_BONDS,
        },
        {
          key: "addonBonds" as const,
          caption: "ADD-ON BONDS",
          values: DEFENSE_ADDON_BONDS,
        },
      ].map((group) => (
        <fieldset key={group.key} disabled={disabled} className={styles.group}>
          <legend>
            <span>{t(group.key)}</span>
            <small>{group.caption}</small>
            {enforceCoreBounds && group.key === "coreBonds" ? (
              <small
                className={styles.counter}
                data-invalid={!validCoreBondSelection(value)}
                aria-live="polite"
              >
                {t("coreSelectionCount", { count: coreCount })}
              </small>
            ) : null}
          </legend>
          <div className={styles.row} data-group={group.key}>
            {group.values.map((bond) => (
              <SelectionButton
                key={bond}
                selected={value.includes(bond)}
                className={styles.choice}
                disabled={
                  enforceCoreBounds &&
                  group.key === "coreBonds" &&
                  !value.includes(bond) &&
                  coreCount >= CORE_BOND_MAX
                }
                title={
                  enforceCoreBounds && group.key === "coreBonds"
                    ? t("coreSelectionRequired")
                    : undefined
                }
                onSelectedChange={(active) =>
                  onChange(
                    active ? [...value, bond] : value.filter((b) => b !== bond),
                  )
                }
              >
                <span className={styles.disc}>
                  <svg
                    className={styles.ring}
                    viewBox="-50 -50 100 100"
                    aria-hidden
                  >
                    <circle r="46" />
                  </svg>
                  <DefenseFactionIcon faction={bond} />
                </span>
                <span className={styles.name}>{t(`faction_${bond}`)}</span>
              </SelectionButton>
            ))}
          </div>
          {enforceCoreBounds && group.key === "coreBonds" ? (
            <p className={styles.rangeHint}>{t("coreSelectionHint")}</p>
          ) : null}
        </fieldset>
      ))}
    </div>
  );
}
