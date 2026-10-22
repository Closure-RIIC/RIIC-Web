import { Link } from "@tanstack/react-router";
import { Play, Users } from "lucide-react";
import { Action, ActionContent, actionClassName, Notice, PageTitle } from "@riic/endfield-ui";
import { useWorkspace } from "../state";
import { Results } from "./Results";
import { OperatorChip } from "./GameArtwork";
import { RosterDialogTrigger } from "./RosterDialog";
import { ProductionDialog } from "./ProductionDialog";

export function SchedulePage() {
  const { workspace, run, busy, result, storageError, resultStorageError, ready, t } = useWorkspace();
  return <div className="ef-page ef-schedule-page">
    <PageTitle accent="chevrons" title={t("帝江号排班", "Dijiang scheduling")} subtitle={t(`${workspace.operators.length} 名干员 · 总控中枢 Lv.${workspace.options.levels.center}`, `${workspace.operators.length} operators · Control center Lv.${workspace.options.levels.center}`)}
      action={<div className="ef-actions">
        <RosterDialogTrigger className={actionClassName({ size: "sm" })} data-roster-edit><ActionContent icon={<Users />}>{t("编辑名单", "Edit roster")}</ActionContent></RosterDialogTrigger>
        <ProductionDialog />
        <Action size="sm" variant="yellow" icon={<Play />} aria-busy={busy} disabled={!ready || busy || workspace.operators.length === 0} onClick={() => run()}>{busy ? t("正在搜索…", "Searching…") : t("生成排班", "Generate schedule")}</Action>
      </div>} />
    {storageError ? <Notice error>{storageError}</Notice> : null}
    {resultStorageError ? <Notice error>{resultStorageError}</Notice> : null}
    {workspace.operators.length ? <div className="ef-roster-preview" aria-label={t("参与排班的干员", "Scheduling operators")}>{workspace.operators.slice(0, 8).map(op => <OperatorChip key={op.name} name={op.name} showWeapon={false} />)}{workspace.operators.length > 8 ? <RosterDialogTrigger className="ef-muted ef-text-action">{t(`查看全部 ${workspace.operators.length} 名`, `View all ${workspace.operators.length}`)}</RosterDialogTrigger> : null}</div> : null}
    {!result && !busy ? <div className="ef-schedule-empty">
      <div className="ef-ship-outline" aria-hidden><span /><span /><span /><span /><span /></div>
      <h2>{workspace.operators.length ? t("准备下一轮生产", "Ready for the next production cycle") : t("先配置你的干员", "Set up your operators")}</h2>
      <p>{workspace.operators.length ? t("在生产配置中选择产物与排班目标，生成后在这里查看全舰安排。", "Choose production and priorities in Production setup, then generate your ship-wide schedule.") : t("登录森空岛自动同步干员、精英化阶段和设施等级，也可点击“编辑名单”手动配置。", "Sign in to Skland to sync operators, elite stages and facility levels, or use Edit roster to configure them manually.")}</p>
      <Link to={workspace.operators.length ? "/manual" : "/skland"} className="ef-text-action">{workspace.operators.length ? t("调整设施等级", "Adjust facility levels") : t("前往森空岛同步", "Open Skland sync")}</Link>
    </div> : null}
    {result ? <Results result={result} /> : null}
  </div>;
}
