import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import { Action, Field } from "@riic/endfield-ui";
import { CompactTabsList, Tabs, TabsContent, TabsTrigger } from "@riic/ui-primitives/tabs";
import { useWorkspace } from "../state";
import { formatClock, formatDuration } from "../step/step-engine.ts";
import { operatorsAt, useMoodSimulation, windowOf } from "../mood-simulation/use-simulation.ts";
import { RoomMoodChart, RoomRateChart } from "../mood-simulation/charts.tsx";
import { OperatorStates } from "../mood-simulation/operator-states.tsx";
import { SIM_HOURS, SIM_SAMPLE_SECONDS, SIM_SPEEDS } from "../mood-simulation/constants.ts";
import { STEP_ROOM_LABELS } from "../step/step-model.ts";

/** 播放刷新频率：8fps 足够顺滑，又不至于每帧重绘全部图表。 */
const PLAYBACK_INTERVAL_MS = 120;

/**
 * 手动排班页下方的心情模拟。默认折叠，展开才渲染图表。
 * 一次只渲染一个舱室的两张图（用标签切换），避免多图同时重绘。
 * 配置全部来自上方排班表（换班整点、一班/二班名单），这里不保存任何设置。
 */
export function MoodSimulationPanel() {
  const { workspace, result, t, ready } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState(24);
  const [speed, setSpeed] = useState(100);
  const [running, setRunning] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [room, setRoom] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const view = useMoodSimulation(workspace, result);
  const moodWindow = useMemo(() => windowOf(view, hours), [view, hours]);
  const total = moodWindow?.totalSec ?? 0;
  const states = useMemo(() => (moodWindow ? operatorsAt(moodWindow, cursor) : []), [moodWindow, cursor]);

  /** 有干员在岗的舱室才出标签。 */
  const rooms = useMemo(() => {
    if (!moodWindow) return [];
    return moodWindow.rooms
      .filter(key => moodWindow.ops.some(op => op.roomKey === key))
      .map(key => ({ key, label: STEP_ROOM_LABELS[key] ?? key }));
  }, [moodWindow]);
  const activeRoom = rooms.some(item => item.key === room) ? room : rooms[0]?.key ?? "";

  useEffect(() => { setRunning(false); setCursor(0); }, [moodWindow]);

  useEffect(() => {
    if (!running || !total) return;
    let last = performance.now();
    timer.current = setInterval(() => {
      const now = performance.now();
      const delta = (now - last) / 1000;
      last = now;
      setCursor(current => {
        const next = current + delta * speed * 60;
        if (next >= total) { setRunning(false); return total; }
        return next;
      });
    }, PLAYBACK_INTERVAL_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [running, speed, total]);

  const disabled = !moodWindow || !rooms.length;
  const hour = cursor / 3600;

  return <section className={`ef-step-section${open ? " is-open" : ""}`} data-mood-simulation>
    <button type="button" className="ef-step-toggle" aria-expanded={open} disabled={!ready}
      onClick={() => setOpen(value => !value)}>
      <span>{t("心情模拟", "Morale simulation")}</span>
      <span className="ef-muted">{disabled
        ? t("先在上方排班表里安排工位", "Assign crews above first")
        : t("按上方排班推演心情、在岗状态与产率", "Replay morale, shift status and output from the schedule above")}</span>
      <ChevronDown aria-hidden className="ef-step-chevron" />
    </button>

    {open && moodWindow && activeRoom ? <div className="ef-step-body">
      <div className="ef-mood-toolbar">
        <Action size="sm" variant={running ? "yellow" : "dark"} icon={running ? <Pause /> : <Play />}
          onClick={() => setRunning(value => !value)}>{running ? t("暂停", "Pause") : t("播放", "Play")}</Action>
        <Action size="sm" icon={<RotateCcw />} onClick={() => { setRunning(false); setCursor(0); }}>{t("重置", "Reset")}</Action>
        <Action size="sm" icon={<SkipForward />} onClick={() => { setRunning(false); setCursor(total); }}>{t("快进到终点", "Skip to end")}</Action>
        <div className="ef-mood-selects">
          <Field label={t("时长", "Horizon")} value={hours} onValueChange={value => setHours(Number(value))}
            options={SIM_HOURS.map(value => ({ value, label: `${value}h` }))} />
          <Field label={t("倍率", "Speed")} value={speed} onValueChange={value => setSpeed(Number(value))}
            options={SIM_SPEEDS.map(value => ({ value, label: `${value}×` }))} />
        </div>
      </div>

      <input className="ef-mood-timeline" type="range" min={0} max={Math.max(1, total)} step={SIM_SAMPLE_SECONDS} value={cursor}
        aria-label={t("时间轴", "Timeline")} onChange={event => { setRunning(false); setCursor(Number(event.target.value)); }} />
      <p className="ef-muted ef-mood-clock" role="status">
        {formatClock(cursor, 0)} · {t("已模拟", "elapsed")} {formatDuration(cursor)} / {formatDuration(total)}
      </p>

      <Tabs value={activeRoom} onValueChange={value => setRoom(String(value))}>
        <CompactTabsList>
          {rooms.map(item => <TabsTrigger key={item.key} value={item.key}>{item.label}</TabsTrigger>)}
        </CompactTabsList>
        {rooms.map(item => <TabsContent key={item.key} value={item.key} className="ef-mood-room-panel">
          <figure className="ef-mood-card">
            <figcaption>{t("心情", "Morale")}</figcaption>
            <RoomMoodChart view={moodWindow.view} room={item.key} hours={hours} history={moodWindow.history} currentHour={hour} />
          </figure>
          <figure className="ef-mood-card">
            <figcaption>{t("产率", "Rate")}</figcaption>
            <RoomRateChart view={moodWindow.view} room={item.key} hours={hours} history={moodWindow.history} currentHour={hour} />
          </figure>
        </TabsContent>)}
      </Tabs>

      <div className="ef-mood-card">
        <figcaption>{t("当前干员状态", "Current operator status")}</figcaption>
        <OperatorStates states={states} />
      </div>

      <details className="ef-mood-log">
        <summary>{t("事件日志", "Event log")}</summary>
        <ul>{moodWindow.view.log.filter(entry => entry.type !== "end" && entry.tSec <= total).slice(-200).map((entry, index) => (
          <li key={`${entry.type}-${entry.tSec}-${index}`}><span className="ef-muted">{formatClock(entry.tSec, 0)}</span> {entry.text}</li>
        ))}</ul>
      </details>
    </div> : null}
  </section>;
}
