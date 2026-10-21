import { useMemo, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Plus, SlidersHorizontal } from "lucide-react";
import { operatorData } from "@shared/endfield-data";
import { manualTemplate, type Assignment } from "@shared/endfield-solver/model.mjs";
import { Action, ActionContent, actionClassName, Field, Notice, PageTitle } from "@shared/endfield-ui";
import { useWorkspace } from "../state";
import { Results } from "./Results";
import { OperatorPortrait, EquippedWeapon } from "./GameArtwork";
import { RosterDialogTrigger } from "./RosterDialog";
import { FacilitySettings } from "./FacilitySettings";
import { DialogFrame } from "./DialogFrame";
import { FacilityBoard, FacilityCard, type FacilityKind } from "./FacilityCard";
import { RosterPage } from "./RosterPage";

type Slot = { key: string; shift: "a" | "b"; index: number };
const facilityKinds: Record<string, FacilityKind> = { 中枢: "center", 会客室: "guest", 培养舱: "grow", 制造舱1: "mfg1", 制造舱2: "mfg2" };
const hour = (value: number) => `${String(value).padStart(2, "0")}:00`;

export function ManualPage() {
  const { workspace, update, result, busy, resultStorageError, run, cancel, ready, locale, t } = useWorkspace();
  const [slot, setSlot] = useState<Slot | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const fieldProps = { disabled: busy || !ready, emptyText: t("没有匹配选项", "No matching options") };
  const template = useMemo(() => { try { return manualTemplate(workspace.options); } catch { return []; } }, [workspace.options]);
  const owned = new Set(workspace.operators.map(op => op.name));
  const assignments = template.map(room => {
    const old = workspace.manual?.find(x => x.key === room.key);
    const crew = (names: string[]) => Array.from({ length: room.slots }, (_, index) => owned.has(names[index]) ? names[index] : "");
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
  const activeRoom = assignments.find(a => a.key === slot?.key);
  const current = slot ? activeRoom?.[slot.shift][slot.index] ?? "" : "";
  const unavailable = new Set(assignments.flatMap(a => (["a", "b"] as const).flatMap(shift => a[shift].filter((name, index) =>
    name && !(a.key === slot?.key && shift === slot.shift && index === slot.index)))));
  const facilityLabel = (key: string) => t(key === "中枢" ? "总控中枢" : key.replace("1", " Ⅰ").replace("2", " Ⅱ"),
    ({ 中枢: "Control center", 会客室: "Reception", 培养舱: "Growth chamber", 制造舱1: "Manufacturing Ⅰ", 制造舱2: "Manufacturing Ⅱ" } as Record<string, string>)[key] ?? key);
  const operatorLabel = (name: string) => locale === "en" ? operatorData(name)?.enName || name : name;
  function selectOperator(name: string) {
    if (!slot || !activeRoom || slot.index >= activeRoom.slots || busy || !ready || (name && (!owned.has(name) || unavailable.has(name)))) return;
    const crew = Array.from({ length: activeRoom.slots }, (_, index) => index === slot.index ? name : activeRoom[slot.shift][index] ?? "");
    change(assignments.indexOf(activeRoom), { ...activeRoom, [slot.shift]: crew });
    setPickerOpen(false);
  }
  return <div className="ef-page ef-schedule-page ef-manual-page">
    <PageTitle title={t("手动排班", "Manual schedule")} subtitle={t("安排两班人员，用同一套算法校验产出与心情闭环。", "Assign two shifts and evaluate production and morale with the same engine.")}
      action={<div className="ef-actions ef-manual-actions">
        <FacilitySettingsDialog />
        <Action size="sm" disabled={busy || !ready || !result?.center || result.rooms.some(r => r.single)} onClick={copyResult}>{t("使用当前双班结果", "Copy current two-shift result")}</Action>
        {busy ? <Action size="sm" variant="red" onClick={cancel}>{t("取消", "Cancel")}</Action> : null}
        <Action size="sm" variant="yellow" aria-busy={busy} disabled={!ready || busy || !workspace.operators.length} onClick={() => run(assignments.map(a => ({ ...a, a: a.a.filter(Boolean), b: a.b.filter(Boolean) })))}>{busy ? t("评估中…", "Evaluating…") : t("评估方案", "Evaluate")}</Action>
      </div>} />
    {!workspace.operators.length ? <Notice><RosterDialogTrigger className="ef-text-action">{t("请先配置我的干员。", "Set up your roster first.")}</RosterDialogTrigger></Notice> : null}
    {workspace.options.assist ? <Notice>{t("手动评估目前需关闭中枢助力，请在首页“生产配置”中关闭。", "Disable central assistance in Production setup before manual evaluation.")}</Notice> : null}
    <Dialog.Root open={pickerOpen} onOpenChange={setPickerOpen}>
      <fieldset disabled={busy || !ready} data-manual-assignments aria-label={t("手动排班工位", "Manual schedule slots")}>
        <FacilityBoard data-manual-board>{assignments.map((a, index) => {
          const kind = facilityKinds[a.key];
          const label = facilityLabel(a.key);
          const category = kind === "center" ? undefined : kind === "guest" ? "线索" : kind === "grow" ? "培养"
            : workspace.options.mfg === "2干员" || (workspace.options.mfg === "1干员1武器" && kind === "mfg1") ? "干员经验" : "武器经验";
          return <FacilityCard key={a.key} kind={kind} label={label} level={workspace.options.levels[kind]} category={category}>
            <div className="ef-manual-hour"><Field {...fieldProps} label={t("换班整点", "Shift change hour")} value={a.hour}
              onValueChange={value => change(index, { ...a, hour: Number(value) })} options={Array.from({ length: 23 }, (_, i) => ({ value: i + 1, label: hour(i + 1) }))} /></div>
            <div className="ef-facility-shifts">{(["a", "b"] as const).map(shift => <div className="ef-facility-shift" key={shift}>
              <div className="ef-facility-shift-label"><b>{shift.toUpperCase()} {t("班", "shift")}</b><span className="ef-shift-time">{shift === "a" ? `00:00 – ${hour(a.hour)}` : `${hour(a.hour)} – 24:00`}</span></div>
              <div className="ef-facility-crew">{Array.from({ length: a.slots }, (_, i) => {
                const name = a[shift][i] ?? "";
                return <div className="ef-manual-slot" key={i}>
                  <Dialog.Trigger className="ef-result-operator ef-manual-operator" disabled={busy || !ready || !owned.size}
                    data-manual-slot={`${a.key}:${shift}:${i}`} aria-label={`${label} · ${shift.toUpperCase()} · ${t("工位", "Slot")} ${i + 1} · ${name ? operatorLabel(name) : t("选择干员", "Select operator")}`}
                    onClick={() => setSlot({ key: a.key, shift, index: i })}>
                    {name ? <OperatorPortrait name={name} size={kind === "center" ? 88 : 68} /> : <span className="ef-manual-empty" aria-hidden><Plus size={24} /></span>}
                    <span title={name ? operatorLabel(name) : undefined}>{name ? operatorLabel(name) : t("选择干员", "Select operator")}</span>
                  </Dialog.Trigger>
                  {name ? <EquippedWeapon name={name} compact /> : null}
                </div>;
              })}</div>
            </div>)}</div>
            {kind === "center" ? <p className="ef-facility-note">{t("各设施按各自标注的时间换班。", "Each facility follows its own shift times.")}</p> : null}
          </FacilityCard>;
        })}</FacilityBoard>
      </fieldset>
      <Dialog.Portal><Dialog.Backdrop className="ef-dialog-backdrop" />
        <DialogFrame className="ef-roster-dialog" bodyClassName="ef-roster-dialog-body" title={t("选择干员", "Select operator")} closeLabel={t("关闭干员选择", "Close operator selection")}
          description={slot ? `${facilityLabel(slot.key)} · ${slot.shift.toUpperCase()} ${t("班", "shift")} · ${t("工位", "Slot")} ${slot.index + 1}。${t("选择后自动保存；已安排至其他工位的干员不可重复选择。", "Selections are saved automatically. Operators assigned elsewhere are unavailable.")}` : undefined}
          footer={<>
            <Action size="sm" disabled={!current || busy || !ready} onClick={() => selectOperator("")}>{t("清空工位", "Clear slot")}</Action>
            <Dialog.Close className={actionClassName({ size: "sm", variant: "yellow" })}><ActionContent>{t("取消", "Cancel")}</ActionContent></Dialog.Close>
          </>}>
          {pickerOpen ? <RosterPage embedded picker={{ value: current, unavailable, onSelect: selectOperator }} /> : null}
        </DialogFrame>
      </Dialog.Portal>
    </Dialog.Root>
    {resultStorageError ? <Notice error>{resultStorageError}</Notice> : null}
    {result && result.status.stopReason === "manual" ? <Results result={result} /> : null}
  </div>;
}

function FacilitySettingsDialog() {
  const { ready, busy, t } = useWorkspace();
  return <Dialog.Root>
    <Dialog.Trigger className={actionClassName({ size: "sm" })} disabled={!ready || busy}><ActionContent icon={<SlidersHorizontal />}>{t("设施与生产", "Facilities & production")}</ActionContent></Dialog.Trigger>
    <Dialog.Portal><Dialog.Backdrop className="ef-dialog-backdrop" />
      <DialogFrame className="ef-production-dialog" title={t("设施与生产", "Facilities & production")} closeLabel={t("关闭设施与生产", "Close facilities & production")}
        footer={<Dialog.Close className={actionClassName({ size: "sm", variant: "yellow" })}><ActionContent>{t("完成", "Done")}</ActionContent></Dialog.Close>}>
        <FacilitySettings />
      </DialogFrame>
    </Dialog.Portal>
  </Dialog.Root>;
}
