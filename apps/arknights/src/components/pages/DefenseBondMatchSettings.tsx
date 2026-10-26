import { useTranslations } from "use-intl";
import {
  Flag,
  UserRound,
  SlidersHorizontal,
  ShieldCheck,
  ChevronDown,
} from "lucide-react";
import { Button } from "../ui/button";
import {
  DEFENSE_CORE_BONDS,
  type BondMatchPreferences,
  type DefenseProfile,
  validCoreBondSelection,
} from "../../defense-team-validation";
import { DefenseBondPicker } from "./DefenseBondPicker";
import styles from "./DefenseBondMatchSettings.module.css";

export function DefenseBondMatchSettings({
  value,
  profile,
  onChange,
  onProfile,
}: {
  value: BondMatchPreferences;
  profile: DefenseProfile | null;
  onChange: (value: BondMatchPreferences) => void;
  onProfile: () => void;
}) {
  const t = useTranslations("DefenseTeam");
  const mine = value.useProfileBonds
    ? (profile?.favoriteFactions ?? [])
    : value.preferredBonds;
  return (
    <div className={styles.settings}>
      <div className={styles.sourceHeader}>
        <div>
          <small>01 / PERSONAL PREFERENCE</small>
          <h3>
            <UserRound size={19} />
            {t("myMatchBonds")}
          </h3>
        </div>
        <div
          className={styles.tabs}
          role="group"
          aria-label={t("bondPreferenceSource")}
        >
          <Button
            variant="outline"
            aria-pressed={value.useProfileBonds}
            onClick={() => onChange({ ...value, useProfileBonds: true })}
          >
            {t("useProfileBonds")}
          </Button>
          <Button
            variant="outline"
            aria-pressed={!value.useProfileBonds}
            onClick={() =>
              onChange({
                ...value,
                useProfileBonds: false,
                preferredBonds: value.preferredBonds.length
                  ? value.preferredBonds
                  : (profile?.favoriteFactions ?? []),
              })
            }
          >
            {t("useCustomBonds")}
          </Button>
        </div>
      </div>
      <p className={styles.hint}>
        {t(value.useProfileBonds ? "profileMatchHint" : "customMatchHint")}
      </p>
      {!validCoreBondSelection(mine) ? (
        <div className={styles.notice}>
          <Flag size={17} />
          {t("noMatchBondsHint")}
          {value.useProfileBonds ? (
            <Button variant="ghost" onClick={onProfile}>
              {t("editBondProfile")}
            </Button>
          ) : null}
        </div>
      ) : null}
      <DefenseBondPicker
        enforceCoreBounds
        value={mine}
        disabled={value.useProfileBonds}
        onChange={(preferredBonds) => onChange({ ...value, preferredBonds })}
      />
      <label className={styles.overlap}>
        <input
          type="checkbox"
          checked={value.avoidBondOverlap}
          onChange={(e) =>
            onChange({ ...value, avoidBondOverlap: e.target.checked })
          }
        />
        <span>
          <strong>
            <ShieldCheck size={17} />
            {t("avoidBondOverlap")}
          </strong>
          <small>{t("overlapMatchHint")}</small>
        </span>
        <b>COMPATIBILITY</b>
      </label>
      <details className={styles.required}>
        <summary>
          <SlidersHorizontal size={18} />
          {t("requiredTeamBonds")}
          <span>
            {value.requiredCoreBonds.length + value.requiredAddonBonds.length}
          </span>
          <ChevronDown size={16} />
        </summary>
        <p className={styles.hint}>{t("requiredBondsHint")}</p>
        <DefenseBondPicker
          value={[...value.requiredCoreBonds, ...value.requiredAddonBonds]}
          onChange={(selected) =>
            onChange({
              ...value,
              requiredCoreBonds: selected.filter((b) =>
                (DEFENSE_CORE_BONDS as readonly string[]).includes(b),
              ),
              requiredAddonBonds: selected.filter(
                (b) => !(DEFENSE_CORE_BONDS as readonly string[]).includes(b),
              ),
            })
          }
        />
      </details>
      <p className={styles.footnote}>{t("matchDataHint")}</p>
    </div>
  );
}
