import { useMemo } from "react";
import { manualTemplate, type Assignment } from "@shared/endfield-solver/model.mjs";
import { Action, Field, Notice, PageTitle, Section } from "@shared/endfield-ui";
import { useWorkspace } from "../state";
import { Results } from "./Results";
import { OperatorPortrait, EquippedWeapon } from "./GameArtwork";
import { RosterDialogTrigger } from "./RosterDialog";
import { FacilitySettings } from "./FacilitySettings";

export function ManualPage() {
  const { workspace, update, result, busy, error, resultStorageError, run, cancel, ready, t } = useWorkspace();
  const fieldProps = { disabled: busy || !ready, emptyText: t("没有匹配选项", "No matching options") };
  const template = useMemo(() => { try { return manualTemplate(workspace.options); } catch { return []; } }, [workspace.options]);
  const owned = new Set(workspace.operators.map(op => op.name));
  const assignments = template.map(room => {
    const old = workspace.manual?.find(x => x.key === room.key);
    const crew = (names: string[]) => names.slice(0, room.slots).map(name => owned.has(name) ? name : "");
    return old ? { ...room, hour: old.hour, a: crew(old.a), b: crew(old.b) } : room;
  });
  function change(index: number, next: Assignment) { update({ ...workspace, manual: assignments.map((a, i) => i === index ? next : a) }); }
  function copyResult() {
    if (!result?.center || result.rooms.some(r => r.single)) return;
    const manual = template.map(room => {
      const data = room.key === "中枢" ? result.center : result.rooms.find(r => r.key === room.key);
      return data ? { ...room, hour: data.hour, a: data.a, b: data.b } : room;
    });
    update({ ...workspace, manual });
  }
  const used = new Set(assignments.flatMap(a => [...a.a, ...a.b]).filter(Boolean));
  return <div className="ef-page">
    <PageTitle title={t("手动排班", "Manual schedule")} subtitle={t("安排两班人员，用同一套算法校验产出与心情闭环。", "Assign two shifts and evaluate production and morale with the same engine.")}
      action={<div className="ef-actions">{busy ? <Action variant="red" onClick={cancel}>{t("取消", "Cancel")}</Action> : null}<Action variant="yellow" aria-busy={busy} disabled={!ready || busy || !workspace.operators.length} onClick={() => run(assignments.map(a => ({ ...a, a: a.a.filter(Boolean), b: a.b.filter(Boolean) })))}>{busy ? t("评估中…", "Evaluating…") : t("评估方案", "Evaluate")}</Action></div>} />
    <FacilitySettings />
    <div className="ef-toolbar"><Action size="sm" disabled={!result?.center || result.rooms.some(r => r.single)} onClick={copyResult}>{t("使用当前双班结果", "Copy current two-shift result")}</Action></div>
    {!workspace.operators.length ? <Notice><RosterDialogTrigger className="ef-text-action">{t("请先配置我的干员。", "Set up your roster first.")}</RosterDialogTrigger></Notice> : null}
    {workspace.options.assist ? <Notice>{t("手动评估目前需关闭中枢助力，请在首页“生产配置”中关闭。", "Disable central assistance in Production setup before manual evaluation.")}</Notice> : null}
    <fieldset disabled={busy || !ready} data-manual-assignments>{assignments.map((a, index) => <Section title={a.key} key={a.key}>
      <div className="ef-form-grid"><Field {...fieldProps} label={t("换班整点", "Shift change hour")} value={a.hour} onValueChange={value => change(index, { ...a, hour: Number(value) })} options={Array.from({ length: 23 }, (_, i) => ({ value: i + 1, label: `${i + 1}:00` }))} />
        {(["a", "b"] as const).flatMap(shift => Array.from({ length: a.slots }, (_, i) => <div key={`${shift}${i}`} className="ef-manual-slot"><Field {...fieldProps} leading={<OperatorPortrait name={a[shift][i] ?? ""} size={40} />} label={`${shift.toUpperCase()} · ${t("工位", "Slot")} ${i+1}`} value={a[shift][i] ?? ""} onValueChange={value => { const crew = Array.from({ length: a.slots }, (_, j) => j === i ? value : a[shift][j] ?? ""); change(index, { ...a, [shift]: crew }); }}
          options={[{ value: "", label: t("未安排", "Unassigned") }, ...workspace.operators.map(op => ({ value: op.name, label: `${op.name} · E${op.elite}`, disabled: used.has(op.name) && a[shift][i] !== op.name }))]} /><EquippedWeapon name={a[shift][i] ?? ""} /></div>))}
      </div>
    </Section>)}</fieldset>
    {error ? <Notice error>{error}</Notice> : null}
    {resultStorageError ? <Notice error>{resultStorageError}</Notice> : null}
    {result && result.status.stopReason === "manual" ? <Results result={result} /> : null}
  </div>;
}
