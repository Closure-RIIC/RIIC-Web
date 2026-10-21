import { Check, Download, TriangleAlert } from "lucide-react";
import { Dialog } from "@base-ui/react/dialog";
import { operatorData } from "@shared/endfield-data";
import { OperatorChip, OperatorPortrait, ProductionIcon } from "./GameArtwork";
import { Action, ActionContent, actionClassName, Notice, Section } from "@shared/endfield-ui";
import type { Result, Mood } from "@shared/endfield-solver/index.mjs";
import { downloadJson, useWorkspace } from "../state";
import { DialogFrame } from "./DialogFrame";
import { categoryLabel, FacilityBoard, FacilityCard } from "./FacilityCard";

const percent = (n: number) => `${(n * 100).toFixed(1)}%`;
const hour = (n: number) => `${String(n).padStart(2, "0")}:00`;
export function Results({ result }: { result: Result }) {
  const { workspace, t } = useWorkspace();
  const warnings = result.status.gaps.length + result.status.approximations.length + result.rooms.filter(room => !room.converged).length;
  const level = (key: string) => key === "会客室" ? workspace.options.levels.guest : key === "培养舱" ? workspace.options.levels.grow : key === "制造舱1" ? workspace.options.levels.mfg1 : workspace.options.levels.mfg2;
  return <section className="ef-schedule-result" aria-label={t("排班结果", "Schedule result")}>
    <header className="ef-result-toolbar">
      <div><h2>{t("排班结果", "Schedule result")}</h2><span className="ef-muted">{t("每日循环", "Daily cycle")} · {(result.elapsedMs / 1000).toFixed(2)}s</span></div>
      <Dialog.Root>
        <Dialog.Trigger className={actionClassName({ size: "sm" })}><ActionContent>{t("详细报告", "Full report")}</ActionContent></Dialog.Trigger>
        <Dialog.Portal><Dialog.Backdrop className="ef-dialog-backdrop" />
          <DialogFrame title={t("排班报告", "Schedule report")} closeLabel={t("关闭排班报告", "Close schedule report")} bodyClassName="ef-report-body"
            description={t("查看搜索状态、心情闭环和逐日模拟。产出单位为等效小时 / 日。", "Search status, morale cycles and daily simulations. Output is measured in effective hours per day.")}
            footer={<>
              <Action size="sm" variant="dark" icon={<Download />} onClick={() => downloadJson("endfield-schedule.json", result)}>{t("导出结果", "Export")}</Action>
              <Dialog.Close className={actionClassName({ size: "sm", variant: "yellow" })}><ActionContent>{t("完成", "Done")}</ActionContent></Dialog.Close>
            </>}><ResultDetails result={result} /></DialogFrame>
        </Dialog.Portal>
      </Dialog.Root>
    </header>
    {result.center ? <>
      <FacilityBoard data-schedule-board>
        <FacilityTile kind="center" label={t("总控中枢", "Control center")} level={workspace.options.levels.center} plan={result.center} scores={result.scores}
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

function FacilityTile({ kind, label, level, plan, room, scores, bonusA, bonusB }: {
  kind: "center" | "guest" | "grow" | "mfg1" | "mfg2"; label: string; level: number;
  plan: { hour: number; a: string[]; b: string[] }; room?: Result["rooms"][number];
  scores?: Record<string, number>;
  bonusA: number | null; bonusB: number | null;
}) {
  const { locale, t } = useWorkspace();
  const bonusLabel = kind === "center" ? t("恢复加成", "Recovery bonus") : t("整体加成", "Total bonus");
  const bonusDescription = kind === "center"
    ? t("全员在岗时的心情恢复加成，作用于每小时 12% 的基础恢复。", "Full-crew recovery bonus, applied to the base recovery of 12% per hour.")
    : t("全员在岗时，相对基础产速的整体加成，含人数与技能；培养舱按培养位加权。日均产出另计心情与休息。", "Full-crew production bonus over the base rate, including staffing and skills; growth is weighted by plots. Daily output also accounts for morale and rest.");
  return <FacilityCard kind={kind} label={label} level={level} category={room?.category}>
    {!room ? <p className="ef-facility-output">{t("全舰心情恢复", "Ship-wide morale recovery")}</p> : null}
    <div className="ef-facility-shifts">
      {(["a", "b"] as const).map((shift, index) => <div className="ef-facility-shift" key={shift}>
        <div className="ef-facility-shift-label"><div><b>{room?.single ? t(index ? "休息" : "工作", index ? "Rest" : "Work") : `${shift.toUpperCase()} ${t("班", "shift")}`}</b>
          {(index ? bonusB : bonusA) != null ? <span className="ef-facility-bonus" title={bonusDescription}>
            {bonusLabel} <strong>+{percent((index ? bonusB : bonusA)!)}</strong>
          </span> : null}</div>
          <span className="ef-shift-time">{room?.single ? `${(index ? room.restHours : room.workHours)?.toFixed(2) ?? "—"} h` : index ? `${hour(plan.hour)} – 24:00` : `00:00 – ${hour(plan.hour)}`}</span></div>
        {plan[shift].length ? <div className="ef-facility-crew">{plan[shift].map(name => <div key={name} className="ef-result-operator">
          <OperatorPortrait name={name} size={kind === "center" ? 88 : 68} />
          <span title={locale === "en" ? operatorData(name)?.enName || name : name}>{locale === "en" ? operatorData(name)?.enName || name : name}</span>
        </div>)}</div> : <p className="ef-facility-rest">{room?.single ? t("原班干员休息后继续生产", "The same crew returns after resting") : t("未安排干员", "No operators assigned")}</p>}
      </div>)}
    </div>
    {scores ? <div className="ef-output-summary">
      <p>{t("全舰日均等效产出", "Ship-wide daily output")} <small>{t("小时 / 日", "h/day")}</small></p>
      <dl>{Object.entries(scores).map(([key, value]) => <div key={key}><dt><ProductionIcon category={key} size={key === "培养" ? 18 : 22} />{categoryLabel(key, t)}</dt><dd>{value.toFixed(2)}</dd></div>)}</dl>
    </div> : null}
    {kind === "center" ? <p className="ef-facility-note">{t("各设施按各自标注的时间换班。", "Each facility follows its own shift times.")}</p> : room?.assist ? <p className="ef-facility-note">{t("中枢助力", "Central assistance")} · {room.assist.shift} · {room.assist.points} {t("点 / 日", "points/day")}</p> : null}
  </FacilityCard>;
}

function ResultDetails({ result }: { result: Result }) {
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
        <div className="ef-shifts">{(["a", "b"] as const).map((s, i) => <div className="ef-shift" key={s}><div className="ef-shift-label"><b>{s.toUpperCase()}</b><span className="ef-shift-time">{i ? `${hour(result.center!.hour)} — 24:00` : `00:00 — ${hour(result.center!.hour)}`}</span></div><div className="ef-crew">{result.center![s].map(n => <OperatorChip key={n} name={n} />)}</div></div>)}</div>
      </article>
      {result.rooms.map(room => <article className="ef-result" key={room.key}><header><h3>{room.key} <span className="ef-muted">/ {room.category}</span></h3><span>{room.value.toFixed(2)} <small className="ef-muted">{t("等效小时 / 日", "effective h/day")}</small></span></header>
        <div className="ef-shifts">{(["a", "b"] as const).map((s, i) => <div className="ef-shift" key={s}><div className="ef-shift-label"><b>{s.toUpperCase()}</b><span className={room.single ? undefined : "ef-shift-time"}>{room.single ? t(i ? "休息阶段" : "单班循环", i ? "Recovery" : "Single-shift cycle") : i ? `${hour(room.hour)} — 24:00` : `00:00 — ${hour(room.hour)}`}</span></div><div className="ef-crew">{room[s].map(n => <OperatorChip key={n} name={n} />)}</div>{room.single ? <p className="ef-muted">{t("工作 / 休息", "Work / rest")} <span className="ef-shift-time">{room.workHours?.toFixed(2)} / {room.restHours?.toFixed(2)} h</span></p> : null}</div>)}</div>
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
