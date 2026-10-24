import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { StepRoom, StepRoomKey, StepShift } from "../step/step-types.ts";
import { clampHour } from "../step/step-model.ts";

export interface StepRoomConfigProps {
  rooms: StepRoom[];
  moods: Record<string, number>;
  work: Record<string, boolean>;
  startHour: number;
  disabled: boolean;
  showImages: boolean;
  labelOf: (name: string) => string;
  iconOf: (name: string) => string | undefined;
  onRoomChange: (key: StepRoomKey, patch: Partial<StepRoom>) => void;
  onMoodChange: (name: string, value: number) => void;
  onWorkChange: (name: string, value: boolean) => void;
  onPick: (key: StepRoomKey, shift: StepShift, index: number) => void;
}

/** 24 小时数轴：绿色 A 班 [0, hour)，黄色 B 班 [hour, 24)；拖动分界改换班时刻。 */
function ShiftAxis({ hour, startHour, disabled, onChange }: { hour: number; startHour: number; disabled: boolean; onChange: (hour: number) => void }) {
  const ref = useRef<SVGSVGElement>(null);
  const width = 1000;
  const unit = width / 24;

  function hourAt(clientX: number): number {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return hour;
    return Math.min(23, Math.max(1, Math.round(((clientX - rect.left) / rect.width) * 24)));
  }
  function pointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (disabled) return;
    event.preventDefault();
    const move = (next: PointerEvent) => onChange(hourAt(next.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const startX = (startHour % 24) * unit;
  return <>
    <svg ref={ref} className="shift-axis" viewBox={`0 0 ${width} 52`} preserveAspectRatio="none" onPointerDown={pointerDown}>
      <rect x="0" y="12" width={width} height="22" fill="#f0f2f5" rx="3" />
      <rect className="axis-seg-green axis-seg-draggable" x="0" y="12" width={hour * unit} height="22" fill="#93c8b1" rx="3" />
      <rect className="axis-seg-yellow axis-seg-draggable" x={hour * unit} y="12" width={(24 - hour) * unit} height="22" fill="#f0d98a" rx="3" />
      <text className="axis-label" x={hour * unit / 2} y="27" textAnchor="middle" style={{ fontSize: 10, fill: "#2a5a4a", pointerEvents: "none" }}>
        {hour >= 3 ? `一轮 ${hour}h` : "一轮"}
      </text>
      <text className="axis-label" x={hour * unit + (24 - hour) * unit / 2} y="27" textAnchor="middle" style={{ fontSize: 10, fill: "#8a5e00", pointerEvents: "none" }}>
        {24 - hour >= 3 ? `二轮 ${24 - hour}h` : "二轮"}
      </text>
      <line x1={startX} y1="6" x2={startX} y2="44" stroke="#c0392b" strokeWidth="2" />
      <circle cx={startX} cy="6" r="3" fill="#c0392b" />
      <text x={startX} y="50" fontSize="10" fill="#c0392b" textAnchor="middle" fontWeight="600">起点 {String(startHour).padStart(2, "0")}:00</text>
      {Array.from({ length: 9 }, (_, index) => index * 3).map(hourTick => <g key={hourTick}>
        <line x1={hourTick * unit} y1="36" x2={hourTick * unit} y2="40" stroke="#aaa" />
        <text className="axis-tick" x={hourTick * unit} y="50" textAnchor="middle">{hourTick}h</text>
      </g>)}
    </svg>
    <div className="rc-axis-info">
      一轮 {String(0).padStart(2, "0")}:00-{String(hour).padStart(2, "0")}:00，二轮 {String(hour).padStart(2, "0")}:00-24:00
    </div>
  </>;
}

function RoomCard({ room, moods, work, startHour, disabled, showImages, labelOf, iconOf, onRoomChange, onMoodChange, onWorkChange, onPick }: {
  room: StepRoom;
} & Omit<StepRoomConfigProps, "rooms" | "onPick"> & { onPick: StepRoomConfigProps["onPick"] }) {
  const [moodOpen, setMoodOpen] = useState(false);
  const shifts: StepShift[] = room.single ? ["a"] : ["a", "b"];
  const names = useMemo(() => {
    const set = new Set<string>();
    for (const shift of shifts) for (const name of (shift === "a" ? room.crewA : room.crewB)) if (name) set.add(name);
    return [...set];
  }, [room, shifts.join("")]);

  const slot = (shift: StepShift, index: number) => {
    const name = (shift === "a" ? room.crewA : room.crewB)[index];
    const icon = name ? iconOf(name) : undefined;
    const classes = `rc-slot${name ? " filled" : ""}`;
    return <div key={`${shift}-${index}`} className={classes} data-room={room.key} data-round={shift} data-idx={index}
      role="button" tabIndex={0} aria-label={`${room.label} ${shift.toUpperCase()} 班 ${index + 1} 号位 ${name ? labelOf(name) : "空位"}`}
      onClick={() => { if (!disabled && room.enabled) onPick(room.key, shift, index); }}
      onKeyDown={event => { if ((event.key === "Enter" || event.key === " ") && !disabled && room.enabled) { event.preventDefault(); onPick(room.key, shift, index); } }}>
      {name ? <>
        {icon && showImages ? <img src={icon} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = "none"; }} /> : null}
        <div className="rc-name">{labelOf(name)}</div>
      </> : "空位"}
    </div>;
  };

  return <div className={`rc-card${room.enabled ? "" : " disabled"}`} data-room={room.key}>
    <div className="rc-header">
      <div className="rc-title">{room.label}</div>
      <div className="rc-checkboxes">
        <label><input type="checkbox" data-action="enable" data-room={room.key} checked={room.enabled} disabled={disabled}
          onChange={event => onRoomChange(room.key, { enabled: event.target.checked })} /> 模拟</label>
        <label><input type="checkbox" data-action="shift" data-room={room.key} checked={!room.single} disabled={disabled}
          onChange={event => onRoomChange(room.key, { single: !event.target.checked })} /> 两轮</label>
      </div>
    </div>
    {room.single ? null : <div className="rc-shift-row">
      <span>一轮时长</span>
      <input type="number" min={1} max={23} value={room.hour} disabled={disabled} data-action="ab" data-room={room.key}
        onChange={event => { if (event.target.value === "") return; onRoomChange(room.key, { hour: clampHour(Number(event.target.value), room.hour) }); }} />
      <span>h，二轮时长</span>
      <input type="number" min={1} max={23} value={24 - room.hour} disabled={disabled} data-action="ba" data-room={room.key}
        onChange={event => { if (event.target.value === "") return; onRoomChange(room.key, { hour: 24 - clampHour(Number(event.target.value), 24 - room.hour) }); }} />
      <span>h</span>
    </div>}
    {room.single ? null : <div className="rc-axis-wrap">
      <ShiftAxis hour={room.hour} startHour={startHour} disabled={disabled} onChange={hour => onRoomChange(room.key, { hour })} />
    </div>}
    {room.products.length ? <div className="rc-product-row">
      <span className="rc-product-label">追踪素材</span>
      {room.products.map(product => <span key={product}>{product}</span>)}
    </div> : null}
    <div className="rc-round-block">
      <div className="rc-round-label"><span className="rc-dot" />{room.single ? "单班" : "一轮"}</div>
      <div className="rc-slots">{Array.from({ length: room.slots }, (_, index) => slot("a", index))}</div>
    </div>
    {room.single ? null : <div className="rc-round-block">
      <div className="rc-round-label r2"><span className="rc-dot" />二轮</div>
      <div className="rc-slots">{Array.from({ length: room.slots }, (_, index) => slot("b", index))}</div>
    </div>}
    <div className="rc-mood-toggle" data-action="toggle-mood" onClick={() => setMoodOpen(value => !value)}>
      <span>心情设置（默认 100%）</span><span className="rc-mood-arrow">{moodOpen ? "▲" : "▼"}</span>
    </div>
    <div className={`rc-mood-body${moodOpen ? " open" : ""}`} id={`rc-mood-${room.key}`}>
      {names.length ? names.map(name => {
        const mood = moods[name] ?? 100;
        const working = work[name] !== false;
        return <div className="rc-mood-row" key={name}>
          <span className="rc-mood-name">{labelOf(name)}</span>
          <input type="number" min={0} max={100} value={mood} className="rc-mood-input" data-name={name} disabled={disabled}
            onChange={event => { if (event.target.value === "") return; onMoodChange(name, Math.min(100, Math.max(0, Math.round(Number(event.target.value))))); }} />
          <span style={{ color: "#888", fontSize: "0.68rem" }}>%</span>
          <label className="rc-mood-work" title="初始是否工作">
            <input type="checkbox" className="rc-work-toggle" data-name={name} checked={working} disabled={disabled}
              onChange={event => onWorkChange(name, event.target.checked)} /> 工作
          </label>
        </div>;
      }) : <div style={{ fontSize: "0.7rem", color: "#999", padding: "4px 0" }}>暂无干员</div>}
    </div>
  </div>;
}

export function StepRoomConfig({ rooms, ...shared }: StepRoomConfigProps) {
  return <div className="room-config-area" id="roomConfigArea">
    {rooms.map(room => <RoomCard key={room.key} {...shared} room={room} />)}
  </div>;
}
