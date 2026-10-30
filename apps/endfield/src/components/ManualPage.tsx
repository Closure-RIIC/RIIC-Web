import { lazyWithMessages } from "../i18n/features-client";
import { operatorName } from "../i18n/game-data";
import { gameLabel } from "../i18n/game-labels";
import { Suspense, useEffect, useMemo, useState } from "react";
import { getRouteApi } from "@tanstack/react-router";
import { Dialog } from "@base-ui/react/dialog";
import { Plus, SlidersHorizontal, Users } from "lucide-react";
import { Tabs, CompactTabsList, TabsTrigger } from "@riic/ui-primitives/tabs";
import { AnimatedNumber } from "@riic/ui-primitives/animated-number";
import { manualTemplate, type Assignment } from "@riic/endfield-solver/model.mjs";
import { Action, ActionContent, actionClassName, Field, Notice, PageTitle } from "@riic/endfield-ui";
import { useWorkspace } from "../state";
import { FacilityBonus, FacilityOutputSummary, ResultReportDialog } from "./Results";
import { OperatorPortrait } from "./GameArtwork";
import { OperatorSkillTooltip } from "./OperatorSkillTooltip";
import { RosterDialogTrigger, useRosterDialog } from "./RosterDialog";
import { FacilitySettings } from "./FacilitySettings";
import { DialogFrame } from "./DialogFrame";
import { FacilityBoard, FacilityCard, type FacilityKind } from "./FacilityCard";
import { RosterPage } from "./RosterPage";
import { workspaceKey } from "../result-cache";
import { useManualEvaluation } from "../use-manual-evaluation";

const MoodSimulationPanel = lazyWithMessages(() => import("./MoodSimulationPanel").then(module => ({ default: module.MoodSimulationPanel })), "apps/endfield/src/components/MoodSimulationPanel.tsx");
const route = getRouteApi("/manual");
type Slot = { key: string; shift: "a" | "b"; index: number };
const facilityKinds: Record<string, FacilityKind> = { 中枢: "center", 会客室: "guest", 培养舱: "grow", 制造舱1: "mfg1", 制造舱2: "mfg2" };
const hour = (value: number) => `${String(value).padStart(2, "0")}:00`;

export function ManualPage() {
  const { workspace, update, result, busy, resultStorageError, cancel, ready, locale, t, reportManualEvaluationError } = useWorkspace();
  const { view } = route.useSearch();
  const navigate = route.useNavigate();
  const simulation = view === "simulation";
  const [slot, setSlot] = useState<Slot | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [facilitiesOpen, setFacilitiesOpen] = useState(false);
  const { rosterOpen } = useRosterDialog();
  const panelVisible = !simulation && !pickerOpen && !facilitiesOpen && !rosterOpen;
  const fieldProps = { disabled: busy || !ready, emptyText: t("Manual.noMatchingOptions") };
  const template = useMemo(() => { try { return manualTemplate(workspace.options); } catch { return []; } }, [workspace.options]);
  const owned = useMemo(() => new Set(workspace.operators.map(op => op.name)), [workspace.operators]);
  const SlotTrigger = owned.size ? Dialog.Trigger : RosterDialogTrigger;
  const assignments = useMemo(() => template.map(room => {
    const old = workspace.manual?.find(x => x.key === room.key);
    const crew = (names: string[]) => Array.from({ length: room.slots }, (_, index) => owned.has(names[index]) ? names[index] : "");
    return old ? { ...room, hour: old.hour, a: crew(old.a), b: crew(old.b) } : room;
  }), [template, workspace.manual, owned]);
  const automatic = useManualEvaluation(workspace, assignments, ready, panelVisible);
  useEffect(() => {
    if (!simulation && automatic.error) return reportManualEvaluationError(automatic.error, automatic.retry, automatic.result);
  }, [simulation, automatic.error, automatic.retry, automatic.result, reportManualEvaluationError]);
  const evaluation = automatic.displayed;
  const emptyScores = Object.fromEntries(workspace.options.priority.map(category => [category, null]));
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
  const facilityLabel = (key: string) => gameLabel(t, key);
  const operatorLabel = (name: string) => operatorName(name, locale);
  function selectOperator(name: string) {
    if (!slot || !activeRoom || slot.index >= activeRoom.slots || busy || !ready || (name && (!owned.has(name) || unavailable.has(name)))) return;
    const crew = Array.from({ length: activeRoom.slots }, (_, index) => index === slot.index ? name : activeRoom[slot.shift][index] ?? "");
    change(assignments.indexOf(activeRoom), { ...activeRoom, [slot.shift]: crew });
    setPickerOpen(false);
  }
  return <div className="ef-page ef-schedule-page ef-manual-page">
    <PageTitle title={t("Manual.manualSchedule")} meta={!simulation && automatic.pending ? <span className="ef-muted" role="status">{t("Manual.calculating")}</span> : undefined}
      action={<div className="ef-actions ef-manual-actions">
        <RosterDialogTrigger className={actionClassName({ size: "sm" })} data-roster-edit disabled={!ready || busy}><ActionContent icon={<Users />}>{t("Manual.editRoster")}</ActionContent></RosterDialogTrigger>
        <FacilitySettingsDialog open={facilitiesOpen} onOpenChange={setFacilitiesOpen} />
        {!simulation ? automatic.result ? <ResultReportDialog result={automatic.result} showWeapons={false} /> : <Action size="sm" disabled>{t("Manual.fullReport")}</Action> : null}
        <Action size="sm" disabled={busy || !ready || !result?.center || result.rooms.some(r => r.single)} onClick={copyResult}>{t("Manual.copyCurrentTwoShiftResult")}</Action>
        {busy ? <Action size="sm" variant="red" onClick={cancel}>{t("Manual.cancel")}</Action> : null}
      </div>} />
    <Tabs value={simulation ? "simulation" : "edit"} onValueChange={value => {
      void navigate({ search: previous => ({ ...previous, view: value === "simulation" ? "simulation" : undefined }), hash: "", resetScroll: false });
    }}>
      <CompactTabsList aria-label={t("Manual.scheduleView")}>
        <TabsTrigger value="edit">{t("Manual.editSchedule")}</TabsTrigger>
        <TabsTrigger value="simulation" disabled={!ready || busy}>{t("Manual.simulationReplay")}</TabsTrigger>
      </CompactTabsList>
    </Tabs>
    {workspace.options.assist && !simulation ? <Notice>{t("Manual.disableCentralAssistanceInFacilitiesProductionBeforeEvaluationSimulation")}</Notice> : null}
    <Dialog.Root open={pickerOpen} onOpenChange={setPickerOpen}>
      <fieldset hidden={simulation} disabled={busy || !ready} data-manual-assignments aria-label={t("Manual.manualScheduleSlots")}
        aria-busy={automatic.pending} data-evaluation-state={!panelVisible ? "editing" : automatic.pending ? "pending" : automatic.error ? "error" : automatic.result ? "ready" : "idle"}>
        {!simulation ? <FacilityBoard data-manual-board>{assignments.map((a, index) => {
          const kind = facilityKinds[a.key];
          const label = facilityLabel(a.key);
          const roomResult = evaluation?.rooms.find(room => room.key === a.key);
          const bonuses = kind === "center" ? [evaluation?.center?.recoveryA, evaluation?.center?.recoveryB] : [roomResult?.bonusA, roomResult?.bonusB];
          const category = kind === "center" ? undefined : kind === "guest" ? "线索" : kind === "grow" ? "培养"
            : workspace.options.mfg === "2干员" || (workspace.options.mfg === "1干员1武器" && kind === "mfg1") ? "干员经验" : "武器经验";
          return <FacilityCard key={a.key} kind={kind} label={label} level={workspace.options.levels[kind]} category={category}
            actions={<div className="ef-manual-hour" title={t("Manual.shiftChangeHour")}><Field {...fieldProps} label={t("Manual.shiftChangeHour")} value={a.hour}
              onValueChange={value => change(index, { ...a, hour: Number(value) })} options={Array.from({ length: 23 }, (_, i) => ({ value: i + 1, label: hour(i + 1) }))} /></div>}>
            {kind !== "center" ? <p className="ef-facility-output" data-manual-output={a.key}>{t("Manual.dailyOutput")} <strong><AnimatedNumber value={roomResult?.value.toFixed(2) ?? "—"} animation="smooth" stagger={0.04} /></strong> {t("Manual.hDay")}</p> : null}
            <div className="ef-facility-shifts">{(["a", "b"] as const).map(shift => <div className="ef-facility-shift" key={shift}>
              <div className="ef-facility-shift-label"><div><b>{shift.toUpperCase()} {t("Manual.shift")}</b><FacilityBonus kind={kind} value={bonuses[shift === "a" ? 0 : 1]} placeholder="—" animated /></div><span className="ef-shift-time">{shift === "a" ? `00:00 – ${hour(a.hour)}` : `${hour(a.hour)} – 24:00`}</span></div>
              <div className="ef-facility-crew">{Array.from({ length: a.slots }, (_, i) => {
                const name = a[shift][i] ?? "";
                const slot = <SlotTrigger className="ef-result-operator ef-manual-operator" disabled={busy || !ready}
                  data-manual-slot={`${a.key}:${shift}:${i}`} aria-label={`${label} · ${shift.toUpperCase()} · ${t("Manual.slot")} ${i + 1} · ${name ? operatorLabel(name) : t("Manual.selectOperator")}`}
                  onClick={() => { if (owned.size) setSlot({ key: a.key, shift, index: i }); }}>
                  {name ? <OperatorPortrait name={name} size={kind === "center" ? 88 : 68} showTitle={false} /> : <span className="ef-manual-empty" aria-hidden><Plus size={24} /></span>}
                  <span>{name ? operatorLabel(name) : t("Manual.selectOperator")}</span>
                </SlotTrigger>;
                return <div className="ef-manual-slot" key={i}>
                  {name ? <OperatorSkillTooltip name={name}>{slot}</OperatorSkillTooltip> : slot}
                </div>;
              })}</div>
            </div>)}</div>
            {kind === "center" ? <FacilityOutputSummary scores={evaluation?.scores ?? emptyScores} production={evaluation?.production} animated /> : null}
            {kind === "center" ? <p className="ef-facility-note">{t("Manual.eachFacilityFollowsItsOwnShiftTimes")}</p> : null}
          </FacilityCard>;
        })}</FacilityBoard> : null}
      </fieldset>
      <Dialog.Portal><Dialog.Backdrop className="ef-dialog-backdrop" />
        <DialogFrame className="ef-roster-dialog" bodyClassName="ef-roster-dialog-body" title={t("Manual.selectOperator")} closeLabel={t("Manual.closeOperatorSelection")}
          description={slot ? `${facilityLabel(slot.key)} · ${slot.shift.toUpperCase()} ${t("Manual.shift")} · ${t("Manual.slot")} ${slot.index + 1}。${t("Manual.selectionsAreSavedAutomaticallyOperatorsAssignedElsewhereAreUnavailable")}` : undefined}
          footer={<>
            <Action size="sm" disabled={!current || busy || !ready} onClick={() => selectOperator("")}>{t("Manual.clearSlot")}</Action>
            <Dialog.Close className={actionClassName({ size: "sm", variant: "yellow" })}><ActionContent>{t("Manual.cancel")}</ActionContent></Dialog.Close>
          </>}>
          {pickerOpen ? <RosterPage embedded picker={{ value: current, unavailable, onSelect: selectOperator }} /> : null}
        </DialogFrame>
      </Dialog.Portal>
    </Dialog.Root>
    {resultStorageError ? <Notice error>{resultStorageError}</Notice> : null}
    {simulation && ready ? <Suspense fallback={<Notice>{t("Manual.loadingSimulation")}</Notice>}><MoodSimulationPanel key={workspaceKey(workspace)} assignments={assignments} /></Suspense> : null}
  </div>;
}

function FacilitySettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { ready, busy, t } = useWorkspace();
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Trigger className={actionClassName({ size: "sm" })} disabled={!ready || busy}><ActionContent icon={<SlidersHorizontal />}>{t("Manual.facilitiesProduction")}</ActionContent></Dialog.Trigger>
    <Dialog.Portal><Dialog.Backdrop className="ef-dialog-backdrop" />
      <DialogFrame className="ef-production-dialog" title={t("Manual.facilitiesProduction")} closeLabel={t("Manual.closeFacilitiesProduction")}
        footer={<Dialog.Close className={actionClassName({ size: "sm", variant: "yellow" })}><ActionContent>{t("Manual.done")}</ActionContent></Dialog.Close>}>
        <FacilitySettings />
      </DialogFrame>
    </Dialog.Portal>
  </Dialog.Root>;
}
