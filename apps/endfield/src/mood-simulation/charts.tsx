import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { StepView } from "../step/step-types.ts";

/** 每个干员固定一个颜色：按名字哈希，名单增删时颜色不会跳变。 */
export function colorForName(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) hash = (hash * 31 + name.charCodeAt(index)) & 0xffff;
  return `hsl(${hash % 360} 52% 42%)`;
}

/** 图例：一条短横线 + 名字。 */
export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return <ul className="ef-mood-legend">
    {items.map(item => <li key={item.label}>
      <span className="ef-mood-legend-line" style={{ background: item.color }} aria-hidden />
      {item.label}
    </li>)}
  </ul>;
}

const tooltipStyle = { fontSize: 11, borderRadius: 8, border: "1px solid var(--ef-line)", background: "var(--ef-raised)" };
const clock = (label: unknown) => {
  const hour = Number(label);
  return `${Math.floor(hour)}:${String(Math.round((hour % 1) * 60)).padStart(2, "0")}`;
};

/** 横轴刻度间隔：24h → 4h，48h → 6h，72/96h → 12h。 */
export function hourTicks(hours: number): number[] {
  const step = hours <= 24 ? 4 : hours <= 48 ? 6 : 12;
  const ticks: number[] = [];
  for (let hour = 0; hour <= hours; hour += step) ticks.push(hour);
  return ticks;
}

/** 横轴通用配置（展开到 XAxis 上）。 */
const hourAxis = (hours: number) => ({
  dataKey: "hour",
  type: "number" as const,
  domain: [0, hours] as [number, number],
  ticks: hourTicks(hours),
  tickFormatter: (hour: number) => `${Math.round(hour)}h`,
  tick: { fontSize: 9, fill: "var(--ef-muted)" },
  stroke: "var(--ef-line)",
  interval: 0 as const,
});

/**
 * 一个舱室的心情图：该舱每个干员一条曲线。
 * recharts 只认直接子元素里的 XAxis/YAxis/Line，所以这里不使用包装组件。
 */
export function RoomMoodChart({ view, room, hours, history, currentHour }: {
  view: StepView; room: string; hours: number; history: StepView["history"]; currentHour?: number;
}) {
  const ops = useMemo(() => view.ops.filter(op => op.roomKey === room), [view, room]);
  const rows = useMemo(() => history.map(sample => {
    const row: Record<string, number | undefined> = { hour: sample.tSec / 3600 };
    for (const op of ops) {
      const mood = sample.moods?.[op.name];
      if (mood != null) row[op.name] = Number(mood.toFixed(1));
    }
    return row;
  }), [history, ops]);

  return <>
    <div className="ef-mood-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 10, bottom: 0, left: 4 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 4" stroke="var(--ef-line)" />
          <XAxis {...hourAxis(hours)} />
          <YAxis domain={[0, 100]} tickFormatter={(value: number) => `${value}%`}
            tick={{ fontSize: 9, fill: "var(--ef-muted)" }} stroke="var(--ef-line)" width={48} />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={clock}
            formatter={(value, name) => [`${Number(value).toFixed(1)}%`, String(name)]} />
          {currentHour != null ? <ReferenceLine x={currentHour} stroke="var(--ef-ink)" strokeDasharray="3 3" /> : null}
          {ops.map(op => <Line key={op.name} dataKey={op.name} type="stepAfter" name={op.name}
            stroke={colorForName(op.name)} strokeWidth={1.4} dot={false} isAnimationActive={false} connectNulls />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
    <Legend items={ops.map(op => ({ label: op.name, color: colorForName(op.name) }))} />
  </>;
}

/** 产率图：中枢看恢复值（%/h），培养舱按产物分线，其余舱一条总产率（百分比，纵轴自适应）。 */
export function RoomRateChart({ view, room, hours, history, currentHour }: {
  view: StepView; room: string; hours: number; history: StepView["history"]; currentHour?: number;
}) {
  const isCentral = room === "中枢";
  const keys = useMemo(() => {
    const names = new Set<string>();
    for (const sample of history) for (const key of Object.keys(sample.rates?.[room] ?? {})) names.add(key);
    return [...names];
  }, [history, room]);

  const rows = useMemo(() => history.map(sample => {
    const row: Record<string, number | undefined> = { hour: sample.tSec / 3600 };
    for (const key of keys) {
      const value = sample.rates?.[room]?.[key];
      if (value != null) row[key] = Number((value * 100).toFixed(1));
    }
    return row;
  }), [history, keys, room]);

  const max = useMemo(() => {
    let peak = 0;
    for (const row of rows) for (const key of keys) peak = Math.max(peak, row[key] ?? 0);
    return Math.max(100, Math.ceil((peak * 1.15) / 50) * 50);
  }, [rows, keys]);

  const unit = isCentral ? "%/h" : "%";
  const labelOf = (key: string) => (key === "_total" ? (isCentral ? "恢复值" : "产率") : key);

  return <>
    <div className="ef-mood-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 10, bottom: 0, left: 4 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 4" stroke="var(--ef-line)" />
          <XAxis {...hourAxis(hours)} />
          <YAxis domain={[0, max]} tickFormatter={(value: number) => `${value}${unit}`}
            tick={{ fontSize: 9, fill: "var(--ef-muted)" }} stroke="var(--ef-line)" width={52} />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={clock}
            formatter={(value, name) => [`${Number(value).toFixed(1)}${unit}`, labelOf(String(name))]} />
          {currentHour != null ? <ReferenceLine x={currentHour} stroke="var(--ef-ink)" strokeDasharray="3 3" /> : null}
          {keys.map(key => <Line key={key} dataKey={key} type="stepAfter" name={key}
            stroke={keys.length > 1 ? colorForName(key) : "var(--ef-ink)"} strokeWidth={1.6} dot={false} isAnimationActive={false} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
    <Legend items={keys.map(key => ({ label: `${labelOf(key)}${isCentral ? `（${unit}）` : ""}`,
      color: keys.length > 1 ? colorForName(key) : "var(--ef-ink)" }))} />
  </>;
}
