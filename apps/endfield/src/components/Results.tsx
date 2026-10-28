import { Check, Download, TriangleAlert } from "lucide-react";
import { Dialog } from "@base-ui/react/dialog";
import { AnimatedNumber } from "@riic/ui-primitives/animated-number";
import { operatorData } from "@riic/endfield-data";
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
  return <section className="ef-schedule-result" aria-label={t("排班结果", "Schedule result")}>
    <header className="ef-result-toolbar">
      <div><h2>{t("排班结果", "Schedule result")}</h2><span className="ef-muted">{t("每日循环", "Daily cycle")} · {(result.elapsedMs / 1000).toFixed(2)}s</span></div>
      <ResultReportDialog result={result} showWeapons={showWeapons} />
    </header>
    {result.center ? <>
      <FacilityBoard data-schedule-board>
        <FacilityTile kind="center" label={t("总控中枢", "Control center")} level={workspace.options.levels.center} plan={result.center} scores={result.scores} production={result.production}
          bonusA={result.center.recoveryA} bonusB={result.center.recoveryB} />
        {result.rooms.map(room => <FacilityTile key={room.key}
          kind={room.key === "会客室" ? "guest" : room.key === "培养舱" ? "grow" : room.key === "制造舱1" ? "mfg1" : "mfg2"}
          label={t(room.key.replace("1", " Ⅰ").replace("2", " Ⅱ"), room.key === "会客室" ? "Reception" : room.key === "培养舱" ? "Growth chamber" : room.key === "制造舱1" ? "Manufacturing Ⅰ" : "Manufacturing Ⅱ")}
          level={level(room.key)} plan={room} room={room} bonusA={room.bonusA} bonusB={room.bonusB} />)}
      </FacilityBoard>
      <div className="ef-result-status" role="status">
        {result.verification.ok ? <span><Check size={14} aria-hidden />{t("人员、工位与产出重算校验通过。", "Crew, capacity and output checks passed.")}</span> : null}
        <span>{result.status.searchComplete ? t("搜索完成", "Search complete") : t("当前搜索范围内的候选方案", "Candidate within the search budget")}</span>
        {warnings ? <span className="ef-result-warning"><TriangleAlert size={14} aria-hidden />{t(`${warnings} 项提示，见详细报告`, `${warnings} notes in the full report`)}</span> : null}
      </div>
    </> : null}
  </section>;
}

export function ResultReportDialog({ result, showWeapons = true }: { result: Result; showWeapons?: boolean }) {
  const { t } = useWorkspace();
  return <Dialog.Root>
    <Dialog.Trigger className={actionClassName({ size: "sm" })}><ActionContent>{t("详细报告", "Full report")}</ActionContent></Dialog.Trigger>
    <Dialog.Portal><Dialog.Backdrop className="ef-dialog-backdrop" />
      <DialogFrame title={t("排班报告", "Schedule report")} closeLabel={t("关闭排班报告", "Close schedule report")} bodyClassName="ef-report-body"
        description={t("查看搜索状态、心情闭环和逐日模拟；主结果显示最终产物 / 日，详细区保留等效小时 / 日。", "Search status, morale cycles and daily simulations; the main result shows final output per day, while details retain effective hours per day.")}
        footer={<>
          <Action size="sm" variant="dark" icon={<Download />} onClick={() => downloadJson("endfield-schedule.json", result)}>{t("导出结果", "Export")}</Action>
          <Dialog.Close className={actionClassName({ size: "sm", variant: "yellow" })}><ActionContent>{t("完成", "Done")}</ActionContent></Dialog.Close>
        </>}><ResultDetails result={result} showWeapons={showWeapons} /></DialogFrame>
    </Dialog.Portal>
  </Dialog.Root>;
}

export function FacilityBonus({ kind, value, placeholder, animated = false }: { kind: FacilityKind; value: number | null | undefined; placeholder?: string; animated?: boolean }) {
  const { t } = useWorkspace();
  if (value == null && !placeholder) return null;
  const label = kind === "center" ? t("恢复加成", "Recovery bonus") : t("整体效率", "Total efficiency");
  const description = kind === "center"
    ? t("全员在岗时的心情恢复加成，作用于每小时 12% 的基础恢复。", "Full-crew recovery bonus, applied to the base recovery of 12% per hour.")
    : t("全员在岗时的实际产速，包含默认 100% 基础效率、人数与技能；培养舱按培养位加权。日均产出另计心情与休息。", "Actual full-crew production rate, including the default 100% base efficiency, staffing and skills; growth is weighted by plots. Daily output also accounts for morale and rest.");
  const text = value == null ? placeholder ?? "—" : kind === "center" ? `+${percent(value)}` : percent(1 + value);
  const recoveryRate = kind === "center" && value != null ? `${(12 * (1 + value)).toFixed(2)}%/h` : null;
  return <>
    <span className="ef-facility-bonus" title={description}>{label} <strong>{animated ? <AnimatedNumber value={text} animation="smooth" stagger={0.04} /> : text}</strong></span>
    {recoveryRate ? <span className="ef-facility-bonus" title={t("每小时心情回复效率 = 12% × (1 + 恢复加成)。", "Hourly morale recovery rate = 12% × (1 + recovery bonus).")}>{t("心情回复效率", "Morale recovery rate")} <strong>{animated ? <AnimatedNumber value={recoveryRate} animation="smooth" stagger={0.04} /> : recoveryRate}</strong></span> : null}
  </>;
}

export function FacilityOutputSummary({ scores, production, animated = false }: { scores: Record<string, number | null>; production?: Record<string, ProductionSummary>; animated?: boolean }) {
  const { t } = useWorkspace();
  const rows: OutputRow[] = Object.entries(scores).flatMap(([key]) => {
    const summary = production?.[key];
    if ((key === "干员经验" || key === "武器经验") && summary?.experience !== undefined && summary.sanity !== undefined) {
      return [{ key, icon: key, label: categoryLabel(key, t), output: summary.sanity.toFixed(2), unit: t("理智", "sanity"), secondary: (summary.experience / 10_000).toFixed(2), secondaryUnit: t("万经验", "10k EXP"), hint: summary.note }];
    }
    return (summary?.options ?? []).map(option => ({
      key: `${key}-${option.kind ?? option.name}`,
      icon: key === "培养" ? option.kind ?? "培养" : key,
      label: key === "培养" ? option.name : categoryLabel(key, t),
      output: option.units.toFixed(2),
      unit: t(key === "线索" ? "条" : "单位", key === "线索" ? "clues" : "units"),
      hint: summary?.note,
    }));
  });
  return <div className="ef-output-summary">
    <p>{t("全舰日均产出", "Ship-wide daily output")} <small>{t("24h 周期 · 最终产物 / 日", "24h cycle · final output / day")}</small></p>
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
    {!room ? <p className="ef-facility-output">{t("全舰心情恢复", "Ship-wide morale recovery")}</p> : null}
    <div className="ef-facility-shifts">
      {(["a", "b"] as const).map((shift, index) => <div className="ef-facility-shift" key={shift}>
        <div className="ef-facility-shift-label"><div><b>{room?.single ? t(index ? "休息" : "工作", index ? "Rest" : "Work") : `${shift.toUpperCase()} ${t("班", "shift")}`}</b>
          <FacilityBonus kind={kind} value={index ? bonusB : bonusA} /></div>
          <span className="ef-shift-time">{room?.single ? `${(index ? room.restHours : room.workHours)?.toFixed(2) ?? "—"} h` : index ? `${hour(plan.hour)} – 24:00` : `00:00 – ${hour(plan.hour)}`}</span></div>
        {plan[shift].length ? <div className="ef-facility-crew">{plan[shift].map(name => <OperatorSkillTooltip key={name} name={name}><div className="ef-result-operator">
          <OperatorPortrait name={name} size={kind === "center" ? 88 : 68} showTitle={false} />
          <span>{locale === "en" ? operatorData(name)?.enName || name : name}</span>
        </div></OperatorSkillTooltip>)}</div> : <p className="ef-facility-rest">{room?.single ? t("原班干员休息后继续生产", "The same crew returns after resting") : t("未安排干员", "No operators assigned")}</p>}
      </div>)}
    </div>
    {scores ? <FacilityOutputSummary scores={scores} production={production} /> : null}
    {kind === "center" ? <p className="ef-facility-note">{t("作战记录与认知载体两类等级按等效经验计算时理智价值相同，可按需切换生产，干员排班保持一致。认知载体的原始经验产率为作战记录的 0.4 倍。", "Battle Records and Cognitive Carriers have the same sanity value when measured as equivalent EXP, so production can be switched without changing operator assignments. Cognitive Carrier raw EXP output is 0.4× Battle Record output.")}</p> : room?.assist ? <p className="ef-facility-note">{t("中枢助力", "Central assistance")} · {room.assist.shift} · {room.assist.points} {t("点 / 日", "points/day")}</p> : null}
  </FacilityCard>;
}

function ResultDetails({ result, showWeapons }: { result: Result; showWeapons: boolean }) {
  const { t } = useWorkspace();
  const reason: Record<string, string> = {
    complete: t("搜索完成", "Search complete"), "node-budget": t("已达到节点预算", "Node budget reached"),
    "time-budget": t("已达到时间预算", "Time budget reached"), "non-converged-candidate": t("部分候选未收敛", "Some candidates did not converge"),
    "approximation-applied": t("包含近似处理", "Approximation applied"), manual: t("手动方案评估", "Manual evaluation"),
  };
  const mood = (value: Mood | null) => value ? `${t("消耗", "Drain")} ${percent(value.consumption)} · ${t("恢复", "Recovery")} ${percent(value.recovery)} · ${value.stable ? t("稳定", "Stable") : t("衰减，采用模拟结果", "Decaying; simulated")}` : "";
  return <Section>
    <Notice>{reason[result.status.stopReason] ?? result.status.stopReason} · {(result.elapsedMs / 1000).toFixed(2)}s · {t("搜索节点", "Nodes")} {result.status.nodes.toLocaleString()} · {t("中枢候选", "Center candidates")} {result.status.centersVisited}/{result.status.centersTotal}</Notice>
    {!result.verification.ok ? <Notice error>{result.verification.errors.join("；")}</Notice> : <p className="ef-muted">{t("人员、工位与产出重算校验通过。", "Crew, capacity and output checks passed.")}</p>}
    {result.center ? <>
      <div className="ef-stats">{Object.entries(result.scores).map(([key, value]) => <div className="ef-stat" key={key}><span>{key}</span><strong>{value.toFixed(2)}</strong><small>{t("等效小时 / 日", "effective h/day")}</small></div>)}</div>
      <article className="ef-result"><header><h3>{t("总控中枢", "Control center")}</h3><span className="ef-muted">{hour(result.center.hour)} {t("换班", "shift change")}</span></header>
        <div className="ef-shifts">{(["a", "b"] as const).map((s, i) => <div className="ef-shift" key={s}><div className="ef-shift-label"><b>{s.toUpperCase()}</b><span className="ef-shift-time">{i ? `${hour(result.center!.hour)} — 24:00` : `00:00 — ${hour(result.center!.hour)}`}</span></div><div className="ef-crew">{result.center![s].map(n => <OperatorChip key={n} name={n} showWeapon={showWeapons} compact />)}</div></div>)}</div>
      </article>
      {result.rooms.map(room => <article className="ef-result" key={room.key}><header><h3>{room.key} <span className="ef-muted">/ {room.category}</span></h3><span>{room.value.toFixed(2)} <small className="ef-muted">{t("等效小时 / 日", "effective h/day")}</small></span></header>
        <div className="ef-shifts">{(["a", "b"] as const).map((s, i) => <div className="ef-shift" key={s}>
          <div className="ef-shift-label"><b>{room.single ? t(i ? "休息" : "工作", i ? "Rest" : "Work") : s.toUpperCase()}</b>
            <span className="ef-shift-time">{room.single ? `${(i ? room.restHours : room.workHours)?.toFixed(2) ?? "—"} h` : i ? `${hour(room.hour)} — 24:00` : `00:00 — ${hour(room.hour)}`}</span></div>
          {room[s].length ? <div className="ef-crew">{room[s].map(n => <OperatorChip key={n} name={n} showWeapon={showWeapons} compact />)}</div>
            : <p className="ef-muted">{room.single ? t("原班干员休息后继续生产", "The same crew returns after resting") : t("未安排干员", "No operators assigned")}</p>}
        </div>)}</div>
        <details className="ef-details"><summary>{t("心情闭环与模拟", "Morale and simulation")}</summary>
          {!room.single ? <><p>A · {mood(room.moodA)}</p><p>B · {mood(room.moodB)}</p></> : null}
          <p>{room.converged ? t("模拟已收敛", "Simulation converged") : t("模拟未收敛", "Simulation did not converge")} · {room.days} {t("天", "days")}</p>
          {room.assist ? <p>{t("中枢助力", "Central assistance")} · {room.assist.shift} · {room.assist.points} {t("点 / 日", "points/day")} · {room.assist.cycle.map((names, i) => `${i + 1}: ${names.join("、")}`).join(" / ")}</p> : null}
          {room.daily.length ? <div className="ef-table-wrap"><table className="ef-table"><thead><tr><th>{t("模拟日", "Day")}</th><th>{t("等效产出", "Effective output")}</th></tr></thead><tbody>{room.daily.slice(-7).map((v, i) => <tr key={i}><td>{Math.max(1, room.daily.length - 6) + i}</td><td>{v.toFixed(3)}</td></tr>)}</tbody></table></div> : null}
        </details>
      </article>)}
    </> : <Notice>{t("本次预算内没有生成方案。请检查干员数量、设施等级或增大搜索预算。", "No plan found within the budget. Check your roster, facility levels or increase the budget.")}</Notice>}
    {result.status.approximations.length ? <Notice>{result.status.approximations.join("；")}</Notice> : null}
    {result.status.gaps.map((g, i) => <Notice key={i}>{g.cat}: {g.reason} {g.detail}</Notice>)}
  </Section>;
}
