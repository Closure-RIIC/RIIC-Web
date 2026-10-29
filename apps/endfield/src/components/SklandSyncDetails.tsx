import { displayText, operatorName } from "../i18n/game-data";
import { type ReactNode, useId } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { ArrowRight, Check, CheckCheck, FileDiff, Info, ShieldCheck, UserPlus, Building2, TrendingUp, TriangleAlert, ChevronDown } from "lucide-react";
import { ActionContent, actionClassName, Notice } from "@riic/endfield-ui";
import { skillTiersOf } from "@riic/endfield-data";
import { unlockedSkillNodes } from "@riic/endfield-skland/skill-nodes";
import type { Operator } from "@riic/endfield-solver/model.mjs";
import { SYNC_FACILITY_KEYS, type SyncFacilityKey } from "../skland-sync-report";
import { useWorkspace } from "../state";
import { DialogFrame } from "./DialogFrame";
import { OperatorPortrait } from "./GameArtwork";
import styles from "./SklandSyncDetails.module.css";

function ChangeSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const id = useId();
  return <details className={styles.section} open>
    <summary><h3 id={id}>{title}<span>{count}</span></h3><ChevronDown size={16} aria-hidden /></summary>
    <div className={styles.rows}>{children}</div>
  </details>;
}
function OperatorRow({ name, children, aside }: { name: string; children?: ReactNode; aside: ReactNode }) {
  const { locale } = useWorkspace();
  return <div className={styles.row}>
    <OperatorPortrait name={name} elite={null} size={40} />
    <div className={styles.rowCopy}><strong>{operatorName(name, locale)}</strong>{children}</div>
    <div className={styles.aside}>{aside}</div>
  </div>;
}
function Difference({ before, after }: { before: string; after: string }) {
  const { t } = useWorkspace();
  return <span className={styles.change}><span>{before}</span><ArrowRight size={14} aria-label={t("SklandSyncDetails.changedTo")} /><strong>{after}</strong></span>;
}
function SkillChanges({ before, after }: { before?: Operator; after: Operator }) {
  const { locale, t } = useWorkspace();
  const tiers = skillTiersOf(after.name);
  const previous = before ? unlockedSkillNodes(tiers, before) : [];
  const current = unlockedSkillNodes(tiers, after);
  const added = current.filter(id => !previous.includes(id));
  const removed = previous.filter(id => !current.includes(id));
  const label = (id: string) => {
    const tier = tiers.find(entry => entry.nodeId === id);
    return tier ? `${displayText(tier, "name", locale)} Lv.${tier.level}` : id;
  };
  return <div className={styles.skills}>
    <p>{t("SklandSyncDetails.unlockedShipSkills")} <b>{before ? `${previous.length}/${tiers.length} → ` : ""}{current.length}/{tiers.length}</b></p>
    {before && before.latestSpaceshipSkillNodes === undefined ? <p>{t("SklandSyncDetails.previouslyEstimatedFromEliteStageNowVerifiedAgainstActual")}</p> : null}
    {added.length ? <div className={styles.skillAdded}><span>{t("SklandSyncDetails.unlocked")}</span>{added.map(id => <span className={styles.skillTag} key={id}>{label(id)}</span>)}</div> : null}
    {removed.length ? <p className={styles.skillRemoved}>{t("SklandSyncDetails.notUnlockedAfterVerification")}：{removed.map(label).join("、")}</p> : null}
  </div>;
}

export function SklandSyncDetails() {
  const { sklandSyncReport: report, sklandSyncDetailsOpen: open, setSklandSyncDetailsOpen: setOpen, setSklandSyncActivity, storageError, locale, t } = useWorkspace();
  if (!report) return null;
  const roomName = (key: SyncFacilityKey) => ({
    center: t("SklandSyncDetails.controlCenter"), mfg1: t("SklandSyncDetails.manufacturingI"), mfg2: t("SklandSyncDetails.manufacturingIi"),
    grow: t("SklandSyncDetails.growthChamber"), guest: t("SklandSyncDetails.reception"),
  })[key];
  const level = (value: number) => value ? `Lv.${value}` : t("SklandSyncDetails.notBuilt");
  const skipped = report.unsupported.length;
  const stats = [
    { label: t("SklandSyncDetails.newOperators"), count: report.added.length, icon: UserPlus },
    { label: t("SklandSyncDetails.progressionChanges"), count: report.updated.length, icon: TrendingUp },
    { label: t("SklandSyncDetails.facilityChanges"), count: report.facilities.length, icon: Building2 },
    { label: t("SklandSyncDetails.excluded"), count: skipped, icon: Info },
  ];
  return <Dialog.Root open={open} onOpenChange={next => { setOpen(next); if (!next) setSklandSyncActivity(null); }}>
    <Dialog.Portal><Dialog.Backdrop className="ef-dialog-backdrop" />
      <DialogFrame className={styles.dialog} title={t("SklandSyncDetails.sklandSyncDetails")}
        closeLabel={t("SklandSyncDetails.closeSyncDetails")}
        description={t("SklandSyncDetails.changesToYourLocalSettingsGroupedByOperatorsAnd")}
        footer={<>
          <span className={styles.safe}><ShieldCheck size={15} />{storageError ? t("SklandSyncDetails.localSaveFailedKeepThisPageOpen") : t("SklandSyncDetails.settingsSaveAutomaticallyInThisBrowser")}</span>
          <Dialog.Close className={actionClassName({ size: "sm", variant: "yellow" })}><ActionContent icon={<Check />}>{t("SklandSyncDetails.gotIt")}</ActionContent></Dialog.Close>
        </>}>
        <div className={styles.summary}>
          <div className={`${styles.statusIcon} ${report.blocked ? styles.warning : ""}`}>{report.blocked ? <TriangleAlert size={23} /> : report.noChanges ? <CheckCheck size={23} /> : <Check size={23} />}</div>
          <div className={styles.headline}>
            <span className={styles.eyebrow}>{t("SklandSyncDetails.sklandSyncReport")}</span>
            <h2>{report.blocked ? t("SklandSyncDetails.localSettingsWerePreserved") : report.noChanges ? t("SklandSyncDetails.syncComplete") : t("SklandSyncDetails.syncCompleteSettingsUpdated")}</h2>
            <p>{t("SklandSyncDetails.schedulingRoster", { value1: report.beforeCount, value2: report.afterCount })}</p>
          </div>
          <time className={styles.time} dateTime={new Date(report.at).toISOString()}>{new Date(report.at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
        </div>
        {report.accountChanged ? <Notice>{t("SklandSyncDetails.accountOrCharacterChangedDifferencesReflectThePreviousLocal")}</Notice> : null}
        {report.blocked ? <Notice error>{report.blocked === "partial" ? t("SklandSyncDetails.theNewAccountReturnedAnIncompleteRosterExistingOperators") : t("SklandSyncDetails.theReturnedOperatorsAreNotSupportedByThisVersion")}</Notice> : null}
        {!report.facilitiesApplied && !report.blocked ? <Notice>{t("SklandSyncDetails.facilityDataIsIncompleteOrInvalidForSchedulingLocal")}</Notice> : null}
        {report.partial && !report.blocked ? <Notice>{t("SklandSyncDetails.thisRosterIsPartialReturnedOperatorsWereUpdatedOther")}</Notice> : null}
        {storageError ? <Notice error>{storageError}</Notice> : null}
        <dl className={`${styles.stats} ${report.noChanges ? styles.quietStats : ""}`}>{stats.map(({ label, count, icon: Icon }) => <div key={label} data-active={count > 0 || undefined}>
          <dt><Icon size={15} />{label}</dt><dd>{count}<span>{t("SklandSyncDetails.items")}</span></dd>
        </div>)}</dl>
        {report.noChanges ? <div className={styles.empty}><CheckCheck size={24} /><div><strong>{t("SklandSyncDetails.noSettingsChanged")}</strong><p>{t("SklandSyncDetails.rosterEliteStagesAndSkillNodesAreUnchangedSee")}</p></div></div> : null}
        {report.added.length ? <ChangeSection key={`${report.at}:added`} title={t("SklandSyncDetails.newOperators")} count={report.added.length}>
          {report.added.map(operator => <OperatorRow key={operator.name} name={operator.name} aside={<span className={styles.added}>+ E{operator.elite}</span>}><SkillChanges after={operator} /></OperatorRow>)}
        </ChangeSection> : null}
        {report.updated.length ? <ChangeSection key={`${report.at}:updated`} title={t("SklandSyncDetails.progressionSkills")} count={report.updated.length}>
          {report.updated.map(row => <OperatorRow key={row.name} name={row.name} aside={row.before.elite === row.after.elite ? <span className={styles.retained}>E{row.after.elite}</span> : <Difference before={`E${row.before.elite}`} after={`E${row.after.elite}`} />}>
            <SkillChanges before={row.before} after={row.after} />
          </OperatorRow>)}
        </ChangeSection> : null}
        {report.facilities.length ? <ChangeSection key={`${report.at}:facilities`} title={t("SklandSyncDetails.facilityLevels")} count={report.facilities.length}>
          {report.facilities.map(row => <div className={styles.row} key={row.key}><span className={styles.facilityIcon}><Building2 size={19} /></span>
            <div className={styles.rowCopy}><strong>{roomName(row.key)}</strong><p>{t("SklandSyncDetails.appliedToSubsequentScheduling")}</p></div><Difference before={level(row.before)} after={level(row.after)} />
          </div>)}
        </ChangeSection> : null}
        {report.removed.length ? <ChangeSection key={`${report.at}:removed`} title={t("SklandSyncDetails.removedFromTheCurrentRoster")} count={report.removed.length}>
          {report.removed.map(operator => <OperatorRow key={operator.name} name={operator.name} aside={<span className={styles.skipped}>{t("SklandSyncDetails.removed")}</span>}><p>{t("SklandSyncDetails.notPresentInTheCompleteRosterAppliedByThis")}</p></OperatorRow>)}
        </ChangeSection> : null}
        {skipped ? <ChangeSection key={`${report.at}:skipped`} title={t("SklandSyncDetails.excludedWhy")} count={skipped}>
          {report.unsupported.map((name, index) => <OperatorRow key={`${name}-${index}`} name={name} aside={<span className={styles.skipped}>{t("SklandSyncDetails.unsupported")}</span>}><p>{t("SklandSyncDetails.notFoundInThisVersionSOperatorCatalogueNo")}</p></OperatorRow>)}
        </ChangeSection> : null}
        {report.facilitiesApplied ? <div className={styles.levels} aria-label={t("SklandSyncDetails.facilityLevelsAfterSync")}>
          <h3><Building2 size={15} />{t("SklandSyncDetails.facilitiesAfterSync")}</h3>
          <dl>{SYNC_FACILITY_KEYS.map(key => <div key={key}><dt>{roomName(key)}</dt><dd>{level(report.levels[key])}</dd></div>)}</dl>
        </div> : null}
        {!report.blocked ? <p className={styles.unchanged}><FileDiff size={14} />{t("SklandSyncDetails.operatorsUnchanged", { operators: report.unchangedOperators, applied: String(report.facilitiesApplied), facilities: report.unchangedFacilities })}</p> : null}
      </DialogFrame>
    </Dialog.Portal>
  </Dialog.Root>;
}
