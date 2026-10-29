import { Link } from "@tanstack/react-router";
import { Play, RefreshCw, Users } from "lucide-react";
import { Action, ActionContent, actionClassName, Notice, PageTitle } from "@riic/endfield-ui";
import { useWorkspace } from "../state";
import { pageLabels } from "../page-labels";
import { Results } from "./Results";
import { OperatorChip } from "./GameArtwork";
import { RosterDialogTrigger } from "./RosterDialog";
import { ProductionDialog } from "./ProductionDialog";

export function SchedulePage() {
  const { workspace, run, busy, result, storageError, resultStorageError, ready, t } = useWorkspace();
  return <div className="ef-page ef-schedule-page">
    <PageTitle accent="chevrons" title={t(pageLabels["/"])} subtitle={t("Schedule.operatorsControlCenterLv", { value1: workspace.operators.length, value2: workspace.options.levels.center })}
      action={<div className="ef-actions">
        <Link to="/skland" className={actionClassName({ size: "sm" })}><ActionContent icon={<RefreshCw />}>{t("Schedule.sklandSync")}</ActionContent></Link>
        <RosterDialogTrigger className={actionClassName({ size: "sm" })} data-roster-edit><ActionContent icon={<Users />}>{t("Schedule.editRoster")}</ActionContent></RosterDialogTrigger>
        <ProductionDialog />
        <Action size="sm" variant="yellow" icon={<Play />} aria-busy={busy} disabled={!ready || busy || workspace.operators.length === 0} onClick={() => run()}>{busy ? t("Schedule.searching") : t("Schedule.generateSchedule")}</Action>
      </div>} />
    {storageError ? <Notice error>{storageError}</Notice> : null}
    {resultStorageError ? <Notice error>{resultStorageError}</Notice> : null}
    {workspace.operators.length ? <div className="ef-roster-preview" aria-label={t("Schedule.schedulingOperators")}>{workspace.operators.slice(0, 8).map(op => <OperatorChip key={op.name} name={op.name} showWeapon={false} />)}{workspace.operators.length > 8 ? <RosterDialogTrigger className="ef-muted ef-text-action">{t("Schedule.viewAll", { value1: workspace.operators.length })}</RosterDialogTrigger> : null}</div> : null}
    {!result && !busy ? <div className="ef-schedule-empty">
      <div className="ef-ship-outline" aria-hidden><span /><span /><span /><span /><span /></div>
      <h2>{workspace.operators.length ? t("Schedule.readyForTheNextProductionCycle") : t("Schedule.setUpYourOperators")}</h2>
      <p>{workspace.operators.length ? t("Schedule.chooseProductionAndPrioritiesInProductionSetupThenGenerate") : t("Schedule.signInToSklandToSyncOperatorsEliteStages")}</p>
      <Link to={workspace.operators.length ? "/manual" : "/skland"} className="ef-text-action">{workspace.operators.length ? t("Schedule.adjustFacilityLevels") : t("Schedule.openSklandSync")}</Link>
    </div> : null}
    {result ? <Results result={result} /> : null}
  </div>;
}
