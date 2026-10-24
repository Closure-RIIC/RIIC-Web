import { Plus } from "lucide-react";
import { Field } from "@riic/endfield-ui";
import { Input } from "@riic/ui-primitives/input";
import { operatorData } from "@riic/endfield-data";
import { useWorkspace } from "../state";
import { FacilityBoard, FacilityCard, type FacilityKind } from "./FacilityCard";
import { OperatorPortrait } from "./GameArtwork";
import type { StepRoom, StepRoomKey, StepShift } from "../step/step-types.ts";

export interface StepRoomConfigProps {
  rooms: StepRoom[]; moods: Record<string, number>; work: Record<string, boolean>;
  startHour: number; disabled: boolean;
  onRoomChange: (key: StepRoomKey, patch: Partial<StepRoom>) => void;
  onMoodChange: (name: string, value: number) => void;
  onWorkChange: (name: string, value: boolean) => void;
  onPick: (key: StepRoomKey, shift: StepShift, index: number) => void;
}

const kinds: Record<StepRoomKey, FacilityKind> = { 中枢: "center", 会客室: "guest", 培养舱: "grow", 制造舱1: "mfg1", 制造舱2: "mfg2" };
const english: Record<StepRoomKey, string> = { 中枢: "Control center", 会客室: "Reception", 培养舱: "Growth chamber", 制造舱1: "Manufacturing Ⅰ", 制造舱2: "Manufacturing Ⅱ" };
const clock = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

export function StepRoomConfig({ rooms, moods, work, startHour, disabled, onRoomChange, onMoodChange, onWorkChange, onPick }: StepRoomConfigProps) {
  const { workspace, locale, t } = useWorkspace();
  const labelOf = (name: string) => locale === "en" ? operatorData(name)?.enName || name : name;
  return <FacilityBoard className="ef-step-facilities" data-step-rooms>
    {rooms.map(room => {
      const kind = kinds[room.key];
      const label = t(room.label, english[room.key]);
      const shifts: StepShift[] = room.single ? ["a"] : ["a", "b"];
      const names = [...new Set(shifts.flatMap(shift => shift === "a" ? room.crewA : room.crewB).filter((name): name is string => !!name))];
      return <FacilityCard key={room.key} kind={kind} label={label} level={workspace.options.levels[kind]} category={room.products.length > 1 ? "培养" : room.products[0]}>
        <div className="ef-step-room-options">
          <label className="ef-toggle"><input type="checkbox" data-step-enable={room.key} checked={room.enabled} disabled={disabled}
            onChange={event => onRoomChange(room.key, { enabled: event.target.checked })} />{t("参与模拟", "Include")}</label>
          <label className="ef-toggle"><input type="checkbox" checked={!room.single} disabled={disabled || !room.enabled}
            onChange={event => onRoomChange(room.key, { single: !event.target.checked })} />{t("两班轮换", "Two shifts")}</label>
        </div>
        <fieldset disabled={disabled || !room.enabled}>
          {!room.single ? <Field label={t("换班整点", "Shift change hour")} value={room.hour} disabled={disabled || !room.enabled}
            onValueChange={value => onRoomChange(room.key, { hour: Number(value) })}
            options={Array.from({ length: 23 }, (_, i) => ({ value: i + 1, label: clock(i + 1) }))} /> : null}
          <p className="ef-facility-note">{t("模拟起点", "Simulation starts at")} {clock(startHour)}</p>
          <div className="ef-facility-shifts">{shifts.map(shift => <div className="ef-facility-shift" key={shift}>
            <div className="ef-facility-shift-label"><b>{shift.toUpperCase()} {t("班", "shift")}</b>
              <span className="ef-shift-time">{room.single ? t("工作 / 休息循环", "Work / rest cycle") : shift === "a" ? `00:00 – ${clock(room.hour)}` : `${clock(room.hour)} – 24:00`}</span>
            </div>
            <div className="ef-facility-crew">{Array.from({ length: room.slots }, (_, index) => {
              const name = (shift === "a" ? room.crewA : room.crewB)[index];
              return <button key={index} type="button" className="ef-result-operator ef-manual-operator" data-step-slot={`${room.key}:${shift}:${index}`}
                disabled={disabled || !room.enabled || !workspace.operators.length}
                aria-label={`${label} · ${shift.toUpperCase()} · ${t("工位", "Slot")} ${index + 1} · ${name ? labelOf(name) : t("选择干员", "Select operator")}`}
                onClick={() => onPick(room.key, shift, index)}>
                {name ? <OperatorPortrait name={name} size={kind === "center" ? 88 : 68} /> : <span className="ef-manual-empty" aria-hidden><Plus size={24} /></span>}
                <span>{name ? labelOf(name) : t("选择干员", "Select operator")}</span>
              </button>;
            })}</div>
          </div>)}</div>
          <details className="ef-details ef-step-moods">
            <summary>{t("初始心情与工作状态", "Starting morale and work status")}</summary>
            {names.length ? names.map(name => <div key={name} className="ef-step-mood-setting">
              <label className="ef-field"><span>{labelOf(name)} · {t("心情 %", "Morale %")}</span>
                <Input type="number" min={0} max={100} step={1} value={moods[name] ?? 100} data-step-mood={name}
                  onChange={event => { if (event.target.value !== "") onMoodChange(name, Math.min(100, Math.max(0, Math.round(Number(event.target.value))))); }} />
              </label>
              <label className="ef-toggle"><input type="checkbox" checked={work[name] !== false}
                onChange={event => onWorkChange(name, event.target.checked)} />{t("起始工作", "Start working")}</label>
            </div>) : <p className="ef-muted">{t("选择干员后可设置初始状态。", "Select operators to set their starting state.")}</p>}
          </details>
        </fieldset>
      </FacilityCard>;
    })}
  </FacilityBoard>;
}
