import { operatorName } from "../i18n/game-data";
import type { MessageTranslator } from "../i18n/types";
import { gameLabel } from "../i18n/game-labels";
import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, usePlotArea } from "recharts";
import { Tabs, CompactTabsList, TabsTrigger } from "@riic/ui-primitives/tabs";
import type { StepRoom, StepView } from "../step/step-types.ts";
import { useWorkspace } from "../state";
import { OperatorStates } from "./operator-states";
import { operatorsAt } from "./presentation";

/** PR #603 的舱室双图与图表实现，接入共享排班回放。 */
export function MoodCharts({ view, timeline, rooms, onSeek }: {
  view: StepView; timeline: StepView; rooms: StepRoom[]; onSeek: (seconds: number) => void;
}) {
  const { locale, t } = useWorkspace();
  const [roomKey, setRoomKey] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string> | null>(null);
  const occupied = rooms.filter(room => view.ops.some(op => op.roomKey === room.key));
  const room = occupied.find(room => room.key === roomKey) ?? occupied[0];
  if (!room) return <p className="ef-muted">{t("charts.assignOperatorsFirst")}</p>;
  const states = operatorsAt(view, room.key);
  const focused = states.filter(op => selected === null || selected.has(op.name));
  const labelOf = (name: string) => operatorName(name, locale);
  function toggleOperator(name: string) {
    setSelected(previous => {
      const next = new Set(previous ?? timeline.ops.map(op => op.name));
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }
  return <div id="moodCharts" className="ef-mood-workbench">
    <Tabs value={room.key} onValueChange={value => setRoomKey(String(value))}>
      <CompactTabsList aria-label={t("charts.simulatedFacility")}>
        {occupied.map(item => <TabsTrigger key={item.key} value={item.key}>{roomLabel(item, t)}</TabsTrigger>)}
      </CompactTabsList>
    </Tabs>
    <div className="ef-step-inspector">
      <div className="ef-step-operator-list">
        <OperatorStates states={states} selected={selected} onSelect={toggleOperator} />
      </div>
      <div className="ef-step-detail">
        <div className="ef-mood-room-panel">
          <figure className="ef-mood-card"><figcaption>{focused.length === 1 ? labelOf(focused[0].name) : roomLabel(room, t)} · {t("charts.morale")}</figcaption>
            <RoomMoodChart timeline={timeline} room={room} cursor={view.tSec} selected={selected} onSeek={onSeek} />
          </figure>
          <figure className="ef-mood-card"><figcaption>{roomLabel(room, t)} · {t("charts.rate")}</figcaption>
            <RoomRateChart timeline={timeline} room={room} cursor={view.tSec} onSeek={onSeek} />
          </figure>
        </div>
        <p className="ef-muted ef-step-chart-summary">{t("charts.theHorizontalAxisShowsElapsedHoursProductionIsA")}</p>
        <p className="ef-muted ef-step-chart-summary">{t("charts.ratesAreRecalculatedFromTheCrewOnShiftZero")}</p>
        <p className="ef-muted ef-step-chart-summary">{t("charts.theDashedLineMarksTheInspectedMomentClickA")}</p>
      </div>
    </div>
  </div>;
}

type ChartProps = { timeline: StepView; room: StepRoom; cursor: number; onSeek: (seconds: number) => void };

/** 名字决定颜色，切换舱室或增删干员时保持稳定；亮度跟随主题。 */
export function colorForName(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index++) hash = (hash * 31 + name.charCodeAt(index)) & 0xffff;
  return `hsl(${hash % 360} 52% var(--ef-step-series-lightness))`;
}

/** 沿用原版短线图例。 */
function Legend({ items }: { items: { label: string; color: string }[] }) {
  return <ul className="ef-mood-legend">
    {items.map(item => <li key={item.label}>
      <span className="ef-mood-legend-line" style={{ background: item.color }} aria-hidden />{item.label}
    </li>)}
  </ul>;
}

const tooltipStyle = { fontSize: 11, borderRadius: 8, border: "1px solid var(--ef-line)", background: "var(--ef-raised)", color: "var(--ef-ink)" };
const clock = (label: unknown) => {
  const minutes = Math.round(Number(label) * 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
};

/** 原版横轴刻度：24h → 4h，48h → 6h，72/96h → 12h。 */
function hourTicks(hours: number): number[] {
  const step = hours <= 24 ? 4 : hours <= 48 ? 6 : 12;
  const ticks: number[] = [];
  for (let hour = 0; hour <= hours; hour += step) ticks.push(hour);
  return ticks;
}

const hourAxis = (hours: number) => ({
  dataKey: "hour", type: "number" as const, domain: [0, hours] as [number, number], ticks: hourTicks(hours),
  tickFormatter: (hour: number) => `${Math.round(hour)}h`, tick: { fontSize: 9, fill: "var(--ef-muted)" },
  stroke: "var(--ef-line)", interval: 0 as const,
});

export function RoomMoodChart({ timeline, room, cursor, selected, onSeek }: ChartProps & { selected: ReadonlySet<string> | null }) {
  const { locale, t } = useWorkspace();
  const { rows, names } = useMoodSeries(timeline, room.key, selected);
  const labelOf = (name: string) => operatorName(name, locale);
  return <>
    <div className="ef-mood-chart" data-step-chart="mood">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart accessibilityLayer data={rows} margin={{ top: 16, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 4" stroke="var(--ef-line)" />
          <XAxis {...hourAxis(timeline.maxTSec / 3600)} />
          <YAxis domain={[0, 100]} padding={{ top: 8, bottom: 4 }} tickFormatter={(value: number) => `${value}%`}
            tick={{ fontSize: 9, fill: "var(--ef-muted)" }} stroke="var(--ef-line)" width={48} />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={clock}
            formatter={(value, name) => [`${Number(value).toFixed(1)}%`, String(name)]} />
          <ReferenceLine x={cursor / 3600} stroke="var(--ef-ink)" strokeDasharray="3 3" />
          {names.map((name, index) => <Line key={name} dataKey={`op${index}`} type="stepAfter" name={labelOf(name)}
            stroke={colorForName(name)} strokeWidth={1.4} dot={false} isAnimationActive={false} connectNulls />)}
          <SeekArea max={timeline.maxTSec} onSeek={onSeek} />
        </LineChart>
      </ResponsiveContainer>
    </div>
    {names.length ? <Legend items={names.map(name => ({ label: labelOf(name), color: colorForName(name) }))} />
      : <p className="ef-mood-empty">{t("charts.selectOperatorCardsToDisplayTheirMoraleCurves")}</p>}
  </>;
}

/** Recharts 渲染 3 万多个 SVG 点会明显卡顿；图表最多保留约 720 个转折点。 */
const MAX_CHART_POINTS = 720;

/** 换班前极短的全员停工不画成 0 点，避免图上出现瞬间掉到 0 的竖线；长停工仍保留。 */
function withoutShortShiftStops(history: StepView["history"], roomKey: string, rateKey: string | null): StepView["history"] {
  if (!rateKey) return history;
  const rateOf = (point: StepView["history"][number]) => point.rates[roomKey]?.[rateKey] ?? 0;
  const points: StepView["history"] = [];
  for (let index = 0; index < history.length;) {
    if (rateOf(history[index]) > 0) { points.push(history[index]); index += 1; continue; }
    let end = index;
    while (end < history.length && rateOf(history[end]) === 0) end += 1;
    const before = points.at(-1);
    const after = history[end];
    const switchGap = before && after && before.activeRounds[roomKey] !== after.activeRounds[roomKey]
      && history[end - 1].tSec - history[index].tSec <= 3600;
    if (!switchGap) for (let cursor = index; cursor < end; cursor += 1) points.push(history[cursor]);
    index = end;
  }
  return points;
}

/**
 * 长时长 + 短采样时压缩曲线：固定步长取点，并保留换班、产物/心情变化导致的
 * 产率跳变点，避免压缩后把台阶或归零点抹平。
 */
function chartHistory(history: StepView["history"], roomKey: string, rateKey: string | null = null): StepView["history"] {
  const source = withoutShortShiftStops(history, roomKey, rateKey);
  if (source.length <= MAX_CHART_POINTS) return source;
  const stride = Math.max(1, Math.ceil(source.length / MAX_CHART_POINTS));
  const points: StepView["history"] = [];
  let lastRound: string | undefined;
  let lastRate: string | undefined;
  for (let index = 0; index < source.length; index += 1) {
    const point = source[index];
    const round = point.activeRounds[roomKey];
    const rate = JSON.stringify(point.rates[roomKey] ?? {});
    if (index % stride === 0 || index === source.length - 1 || round !== lastRound || rate !== lastRate) {
      points.push(point);
      lastRound = round;
      lastRate = rate;
    }
  }
  return points;
}

function useMoodSeries(timeline: StepView, roomKey: string, selected: ReadonlySet<string> | null) {
  return useMemo(() => {
    const names = timeline.ops.filter(op => op.roomKey === roomKey && (selected === null || selected.has(op.name))).map(op => op.name);
    const rows = chartHistory(timeline.history, roomKey).map(point => ({ hour: point.tSec / 3600,
      ...Object.fromEntries(names.map((name, index) => [`op${index}`, point.moods[name]])),
    }));
    return { rows, names };
  }, [timeline, roomKey, selected]);
}

export function RoomRateChart({ timeline, room, cursor, onSeek }: ChartProps) {
  const { t } = useWorkspace();
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const { rows, keys, max, activeKey } = useRateSeries(timeline, room.key, selectedProduct);
  const summary = useMemo(() => activeKey ? integrateRate(timeline, room.key, activeKey) : null, [timeline, room.key, activeKey]);
  const labelOf = (key: string) => key === "_total"
    ? room.key === "中枢" ? t("charts.recoveryBonus") : t("charts.rate") : productLabel(key, t);
  const colorOf = () => "var(--ef-ink)";
  return <>
    {keys.length > 1 ? <Tabs value={activeKey ?? ""} onValueChange={value => setSelectedProduct(String(value))}>
      <CompactTabsList aria-label={t("charts.product")}>
        {keys.map(key => <TabsTrigger key={key} value={key}>{productLabel(key, t)}</TabsTrigger>)}
      </CompactTabsList>
    </Tabs> : null}
    <div className="ef-mood-chart" data-step-chart="rate">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart accessibilityLayer data={rows} margin={{ top: 16, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 4" stroke="var(--ef-line)" />
          <XAxis {...hourAxis(timeline.maxTSec / 3600)} />
          <YAxis domain={[0, max]} padding={{ top: 8, bottom: 4 }} tickFormatter={(value: number) => `${value}%`}
            tick={{ fontSize: 9, fill: "var(--ef-muted)" }} stroke="var(--ef-line)" width={52} />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={clock}
            formatter={(value, name) => [`${Number(value).toFixed(1)}%`, String(name)]} />
          <ReferenceLine x={cursor / 3600} stroke="var(--ef-ink)" strokeDasharray="3 3" />
          {activeKey ? <Line dataKey="rate0" type="stepAfter" name={labelOf(activeKey)}
            stroke={colorOf()} strokeWidth={1.6} dot={false} isAnimationActive={false} /> : null}
          <SeekArea max={timeline.maxTSec} onSeek={onSeek} />
        </LineChart>
      </ResponsiveContainer>
    </div>
    {activeKey ? <Legend items={[{ label: labelOf(activeKey), color: colorOf() }]} /> : null}
    {summary ? <p className="ef-muted ef-step-chart-summary">
      {room.key === "中枢"
        ? t("charts.integralHAverage", { value1: summary.integral.toFixed(1), value2: summary.average.toFixed(1) })
        : t("charts.integralBaseHoursAverage", { value1: summary.integral.toFixed(2), value2: summary.average.toFixed(2), value3: (summary.average * 100).toFixed(1) })}
    </p> : null}
  </>;
}

/** 对完整历史（不是降采样后的图）按台阶做积分；产率单位保持引擎口径。 */
function integrateRate(timeline: StepView, roomKey: string, key: string) {
  const points = timeline.history;
  let integral = 0;
  for (let index = 1; index < points.length; index += 1) {
    const rate = points[index - 1].rates[roomKey]?.[key] ?? 0;
    integral += rate * (points[index].tSec - points[index - 1].tSec) / 3600;
  }
  const last = points.at(-1);
  if (last && last.tSec < timeline.maxTSec) integral += (last.rates[roomKey]?.[key] ?? 0) * (timeline.maxTSec - last.tSec) / 3600;
  const hours = timeline.maxTSec / 3600;
  return { integral, average: hours > 0 ? integral / hours : 0 };
}

function useRateSeries(timeline: StepView, roomKey: string, selectedKey: string | null) {
  return useMemo(() => {
    const keys = [...new Set(timeline.history.flatMap(point => Object.keys(point.rates[roomKey] ?? {})))];
    const activeKey = selectedKey && keys.includes(selectedKey) ? selectedKey : keys[0] ?? null;
    const history = chartHistory(timeline.history, roomKey, activeKey);
    const rows = history.map(point => {
      const rate = activeKey ? point.rates[roomKey]?.[activeKey] ?? 0 : 0;
      // 中枢本来就是百分点；生产舱室倍率转成原版图表的百分比。
      const value = roomKey === "中枢" ? rate : rate * 100;
      return { hour: point.tSec / 3600, rate0: value };
    });
    const peak = rows.reduce((highest, point) => Math.max(highest, point.rate0), 0);
    return { rows, keys, max: Math.max(100, Math.ceil((peak * 1.15) / 50) * 50), activeKey };
  }, [timeline, roomKey, selectedKey]);
}

function SeekArea({ max, onSeek }: { max: number; onSeek: (seconds: number) => void }) {
  const area = usePlotArea();
  if (!area) return null;
  return <rect data-step-chart-seek x={area.x} y={area.y} width={area.width} height={area.height} fill="transparent" style={{ cursor: "crosshair" }}
    onClick={event => {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (bounds.width) onSeek(Math.round(Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)) * max / 60) * 60);
    }} />;
}

function roomLabel(room: StepRoom, t: MessageTranslator) {
  return gameLabel(t, room.key);
}
function productLabel(product: string, t: MessageTranslator) {
  return gameLabel(t, product);
}
