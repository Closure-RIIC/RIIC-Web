import { operatorName } from "../i18n/game-data";
import { gameLabel } from "../i18n/game-labels";
import { Check, Download, TriangleAlert } from "lucide-react";
import { Dialog } from "@base-ui/react/dialog";
import { AnimatedNumber } from "@riic/ui-primitives/animated-number";
import { OperatorChip, OperatorPortrait, ProductionIcon } from "./GameArtwork";
import { OperatorSkillTooltip } from "./OperatorSkillTooltip";
import { Action, ActionContent, actionClassName, Notice, Section } from "@riic/endfield-ui";
import type { ProductionSummary, Result, Mood } from "@riic/endfield-solver/index.mjs";
import { downloadJson, useWorkspace } from "../state";
import { DialogFrame } from "./DialogFrame";
import { categoryLabel, FacilityBoard, FacilityCard, type FacilityKind } from "./FacilityCard";

const percent = (n: number) => `${(n * 100).toFixed(1)}%`;
const hour = (n: number) => `${String(n).padStart(2, "0")}:00`;
type OutputRow = {
  key: string;
  icon: string;
  label: string;
  output: string;
  unit: string;
  secondary?: string;
  secondaryUnit?: string;
  hint?: string;
};
export function Results({ result, showWeapons = true }: { result: Result; showWeapons?: boolean }) {
  const { workspace, t } = useWorkspace();
  const warnings = result.status.gaps.length + result.status.approximations.length + result.rooms.filter(room => !room.converged).length;
  const level = (key: string) => key === "会客室" ? workspace.options.levels.guest : key === "培养舱" ? workspace.options.levels.grow : key === "制造舱1" ? workspace.options.levels.mfg1 : workspace.options.levels.mfg2;
  return <section className="ef-schedule-result" aria-label={t("Results.scheduleResult")}>
    <header className="ef-result-toolbar">
      <div><h2>{t("Results.scheduleResult")}</h2><span className="ef-muted">{t("Results.dailyCycle")} · {(result.elapsedMs / 1000).toFixed(2)}s</span></div>
      <ResultReportDialog result={result} showWeapons={showWeapons} />
    </header>
    {result.center ? <>
      <FacilityBoard data-schedule-board>
        <FacilityTile kind="center" label={t("Results.controlCenter")} level={workspace.options.levels.center} plan={result.center} scores={result.scores} production={result.production}
          bonusA={result.center.recoveryA} bonusB={result.center.recoveryB} />
        {result.rooms.map(room => <FacilityTile key={room.key}
          kind={room.key === "会客室" ? "guest" : room.key === "培养舱" ? "grow" : room.key === "制造舱1" ? "mfg1" : "mfg2"}
          label={gameLabel(t, room.key)}
          level={level(room.key)} plan={room} room={room} bonusA={room.bonusA} bonusB={room.bonusB} />)}
      </FacilityBoard>
      <div className="ef-result-status" role="status">
        {result.verification.ok ? <span><Check size={14} aria-hidden />{t("Results.crewCapacityAndOutputChecksPassed")}</span> : null}
        <span>{result.status.searchComplete ? t("Results.searchComplete") : t("Results.candidateWithinTheSearchBudget")}</span>
        {warnings ? <span className="ef-result-warning"><TriangleAlert size={14} aria-hidden />{t("Results.notesInTheFullReport", { value1: warnings })}</span> : null}
      </div>
    </> : null}
  </section>;
}

export function ResultReportDialog({ result, showWeapons = true }: { result: Result; showWeapons?: boolean }) {
  const { t } = useWorkspace();
  return <Dialog.Root>
    <Dialog.Trigger className={actionClassName({ size: "sm" })}><ActionContent>{t("Results.fullReport")}</ActionContent></Dialog.Trigger>
    <Dialog.Portal><Dialog.Backdrop className="ef-dialog-backdrop" />
      <DialogFrame title={t("Results.scheduleReport")} closeLabel={t("Results.closeScheduleReport")} bodyClassName="ef-report-body"
        description={t("Results.searchStatusMoraleCyclesAndDailySimulationsTheMain")}
        footer={<>
          <Action size="sm" variant="dark" icon={<Download />} onClick={() => downloadJson("endfield-schedule.json", result)}>{t("Results.export")}</Action>
          <Dialog.Close className={actionClassName({ size: "sm", variant: "yellow" })}><ActionContent>{t("Results.done")}</ActionContent></Dialog.Close>
        </>}><ResultDetails result={result} showWeapons={showWeapons} /></DialogFrame>
    </Dialog.Portal>
  </Dialog.Root>;
}

export function FacilityBonus({ kind, value, placeholder, animated = false }: { kind: FacilityKind; value: number | null | undefined; placeholder?: string; animated?: boolean }) {
  const { t } = useWorkspace();
  if (value == null && !placeholder) return null;
  const label = kind === "center" ? t("Results.recoveryBonus") : t("Results.totalEfficiency");
  const description = kind === "center"
    ? t("Results.fullCrewRecoveryBonusAppliedToTheBaseRecovery")
    : t("Results.actualFullCrewProductionRateIncludingTheDefault100");
  const text = value == null ? placeholder ?? "—" : kind === "center" ? `+${percent(value)}` : percent(1 + value);
  const recoveryRate = kind === "center" && value != null ? `${(12 * (1 + value)).toFixed(2)}%/h` : null;
  return <>
    <span className="ef-facility-bonus" title={description}>{label} <strong>{animated ? <AnimatedNumber value={text} animation="smooth" stagger={0.04} /> : text}</strong></span>
    {recoveryRate ? <span className="ef-facility-bonus" title={t("Results.hourlyMoraleRecoveryRate121RecoveryBonus")}>{t("Results.moraleRecoveryRate")} <strong>{animated ? <AnimatedNumber value={recoveryRate} animation="smooth" stagger={0.04} /> : recoveryRate}</strong></span> : null}
  </>;
}

export function FacilityOutputSummary({ scores, production, animated = false }: { scores: Record<string, number | null>; production?: Record<string, ProductionSummary>; animated?: boolean }) {
  const { t } = useWorkspace();
  const rows: OutputRow[] = Object.entries(scores).flatMap(([key]) => {
    const summary = production?.[key];
    if ((key === "干员经验" || key === "武器经验") && summary?.experience !== undefined && summary.sanity !== undefined) {
      return [{ key, icon: key, label: categoryLabel(key, t), output: summary.sanity.toFixed(2), unit: t("Results.sanity"), secondary: (summary.experience / 10_000).toFixed(2), secondaryUnit: t("Results.10kExp"), hint: summary.note }];
    }
    return (summary?.options ?? []).map(option => ({
      key: `${key}-${option.kind ?? option.name}`,
      icon: key === "培养" ? option.kind ?? "培养" : key,
      label: key === "培养" ? option.name : categoryLabel(key, t),
      output: option.units.toFixed(2),
      unit: (key === "线索" ? t("Results.clues") : t("Results.units")),
      hint: summary?.note,
    }));
  });
  return <div className="ef-output-summary">
    <p>{t("Results.shipWideDailyOutput")} <small>{t("Results.24hCycleFinalOutputDay")}</small></p>
    <dl>{rows.map(row => <div key={row.key}><dt><ProductionIcon category={row.icon} size={22} />{row.label}</dt><dd title={row.hint}>{animated ? <AnimatedNumber value={row.output} animation="smooth" stagger={0.04} /> : row.output}<small> {row.unit}</small>{row.secondary ? <> · {animated ? <AnimatedNumber value={row.secondary} animation="smooth" stagger={0.04} /> : row.secondary}<small> {row.secondaryUnit}</small></> : null}</dd></div>)}</dl>
  </div>;
}

function FacilityTile({ kind, label, level, plan, room, scores, production, bonusA, bonusB }: {
  kind: "center" | "guest" | "grow" | "mfg1" | "mfg2"; label: string; level: number;
  plan: { hour: number; a: string[]; b: string[] }; room?: Result["rooms"][number];
  scores?: Record<string, number>;
  production?: Record<string, ProductionSummary>;
  bonusA: number | null; bonusB: number | null;
}) {
  const { locale, t } = useWorkspace();
  return <FacilityCard kind={kind} label={label} level={level} category={room?.category}>
    {!room ? <p className="ef-facility-output">{t("Results.shipWideMoraleRecovery")}</p> : null}
    <div className="ef-facility-shifts">
      {(["a", "b"] as const).map((shift, index) => <div className="ef-facility-shift" key={shift}>
        <div className="ef-facility-shift-label"><div><b>{room?.single ? (index ? t("Results.rest") : t("Results.work")) : `${shift.toUpperCase()} ${t("Results.shift")}`}</b>
          <FacilityBonus kind={kind} value={index ? bonusB : bonusA} /></div>
          <span className="ef-shift-time">{room?.single ? `${(index ? room.restHours : room.workHours)?.toFixed(2) ?? "—"} h` : index ? `${hour(plan.hour)} – 24:00` : `00:00 – ${hour(plan.hour)}`}</span></div>
        {plan[shift].length ? <div className="ef-facility-crew">{plan[shift].map(name => <OperatorSkillTooltip key={name} name={name}><div className="ef-result-operator">
          <OperatorPortrait name={name} size={kind === "center" ? 88 : 68} showTitle={false} />
          <span>{operatorName(name, locale)}</span>
        </div></OperatorSkillTooltip>)}</div> : <p className="ef-facility-rest">{room?.single ? t("Results.theSameCrewReturnsAfterResting") : t("Results.noOperatorsAssigned")}</p>}
      </div>)}
    </div>
    {scores ? <FacilityOutputSummary scores={scores} production={production} /> : null}
    {kind === "center" ? <p className="ef-facility-note">{t("Results.battleRecordsAndCognitiveCarriersHaveTheSameSanity")}</p> : room?.assist ? <p className="ef-facility-note">{t("Results.centralAssistance")} · {room.assist.shift} · {room.assist.points} {t("Results.pointsDay")}</p> : null}
  </FacilityCard>;
}

function ResultDetails({ result, showWeapons }: { result: Result; showWeapons: boolean }) {
  const { t } = useWorkspace();
  const reason: Record<string, string> = {
    complete: t("Results.searchComplete"), "node-budget": t("Results.nodeBudgetReached"),
    "time-budget": t("Results.timeBudgetReached"), "non-converged-candidate": t("Results.someCandidatesDidNotConverge"),
    "approximation-applied": t("Results.approximationApplied"), manual: t("Results.manualEvaluation"),
  };
  const mood = (value: Mood | null) => value ? `${t("Results.drain")} ${percent(value.consumption)} · ${t("Results.recovery")} ${percent(value.recovery)} · ${value.stable ? t("Results.stable") : t("Results.decayingSimulated")}` : "";
  return <Section>
    <Notice>{reason[result.status.stopReason] ?? result.status.stopReason} · {(result.elapsedMs / 1000).toFixed(2)}s · {t("Results.nodes")} {result.status.nodes.toLocaleString()} · {t("Results.centerCandidates")} {result.status.centersVisited}/{result.status.centersTotal}</Notice>
    {!result.verification.ok ? <Notice error>{result.verification.errors.join("；")}</Notice> : <p className="ef-muted">{t("Results.crewCapacityAndOutputChecksPassed")}</p>}
    {result.center ? <>
      <div className="ef-stats">{Object.entries(result.scores).map(([key, value]) => <div className="ef-stat" key={key}><span>{key}</span><strong>{value.toFixed(2)}</strong><small>{t("Results.effectiveHDay")}</small></div>)}</div>
      <article className="ef-result"><header><h3>{t("Results.controlCenter")}</h3><span className="ef-muted">{hour(result.center.hour)} {t("Results.shiftChange")}</span></header>
        <div className="ef-shifts">{(["a", "b"] as const).map((s, i) => <div className="ef-shift" key={s}><div className="ef-shift-label"><b>{s.toUpperCase()}</b><span className="ef-shift-time">{i ? `${hour(result.center!.hour)} — 24:00` : `00:00 — ${hour(result.center!.hour)}`}</span></div><div className="ef-crew">{result.center![s].map(n => <OperatorChip key={n} name={n} showWeapon={showWeapons} compact />)}</div></div>)}</div>
      </article>
      {result.rooms.map(room => <article className="ef-result" key={room.key}><header><h3>{room.key} <span className="ef-muted">/ {room.category}</span></h3><span>{room.value.toFixed(2)} <small className="ef-muted">{t("Results.effectiveHDay")}</small></span></header>
        <div className="ef-shifts">{(["a", "b"] as const).map((s, i) => <div className="ef-shift" key={s}>
          <div className="ef-shift-label"><b>{room.single ? (i ? t("Results.rest") : t("Results.work")) : s.toUpperCase()}</b>
            <span className="ef-shift-time">{room.single ? `${(i ? room.restHours : room.workHours)?.toFixed(2) ?? "—"} h` : i ? `${hour(room.hour)} — 24:00` : `00:00 — ${hour(room.hour)}`}</span></div>
          {room[s].length ? <div className="ef-crew">{room[s].map(n => <OperatorChip key={n} name={n} showWeapon={showWeapons} compact />)}</div>
            : <p className="ef-muted">{room.single ? t("Results.theSameCrewReturnsAfterResting") : t("Results.noOperatorsAssigned")}</p>}
        </div>)}</div>
        <details className="ef-details"><summary>{t("Results.moraleAndSimulation")}</summary>
          {!room.single ? <><p>A · {mood(room.moodA)}</p><p>B · {mood(room.moodB)}</p></> : null}
          <p>{room.converged ? t("Results.simulationConverged") : t("Results.simulationDidNotConverge")} · {room.days} {t("Results.days")}</p>
          {room.assist ? <p>{t("Results.centralAssistance")} · {room.assist.shift} · {room.assist.points} {t("Results.pointsDay")} · {room.assist.cycle.map((names, i) => `${i + 1}: ${names.join("、")}`).join(" / ")}</p> : null}
          {room.daily.length ? <div className="ef-table-wrap"><table className="ef-table"><thead><tr><th>{t("Results.day")}</th><th>{t("Results.effectiveOutput")}</th></tr></thead><tbody>{room.daily.slice(-7).map((v, i) => <tr key={i}><td>{Math.max(1, room.daily.length - 6) + i}</td><td>{v.toFixed(3)}</td></tr>)}</tbody></table></div> : null}
        </details>
      </article>)}
    </> : <Notice>{t("Results.noPlanFoundWithinTheBudgetCheckYourRoster")}</Notice>}
    {result.status.approximations.length ? <Notice>{result.status.approximations.join("；")}</Notice> : null}
    {result.status.gaps.map((g, i) => <Notice key={i}>{g.cat}: {g.reason} {g.detail}</Notice>)}
  </Section>;
}
